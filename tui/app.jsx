import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from 'ink';
import MainMenu from './components/MainMenu.jsx';
import ModeSelect from './components/ModeSelect.jsx';
import ModelSelect from './components/ModelSelect.jsx';
import ChatScreen from './components/ChatScreen.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import SetupScreen from './components/SetupScreen.jsx';
import SessionSelect from './components/SessionSelect.jsx';
import { MODES } from './constants.js';
import { listModels, getModel } from '../config/models.js';
import { hasAnyApiKey } from '../utils/configManager.js';
import {
  deleteSession,
  getLastSession,
  listSessions,
  loadSession,
  renameSession,
  setLastActiveSession,
} from '../utils/sessionStore.js';

const DEFAULT_MODEL_KEY = 'kimi';

function resolveConfiguredModelKey(preferredProvider = null) {
  const models = listModels();
  const ordered = preferredProvider
    ? [...models].sort((left, right) => {
        if (left.provider === preferredProvider && right.provider !== preferredProvider) return -1;
        if (right.provider === preferredProvider && left.provider !== preferredProvider) return 1;
        if (left.key === DEFAULT_MODEL_KEY) return -1;
        if (right.key === DEFAULT_MODEL_KEY) return 1;
        return 0;
      })
    : models;

  for (const entry of ordered) {
    try {
      getModel(entry.key);
      return entry.key;
    } catch {
      // Continue until we find a configured model.
    }
  }

  return DEFAULT_MODEL_KEY;
}

function getModelDisplay(key) {
  const entry = listModels().find((model) => model.key === key);
  return entry
    ? { label: entry.name, id: entry.id, provider: entry.provider, providerName: entry.providerName }
    : { label: 'Unknown Model', id: '', provider: '', providerName: '' };
}

const App = () => {
  const initialModelKey = resolveConfiguredModelKey();
  const initialModelConfig = hasAnyApiKey()
    ? (() => {
        try {
          return { ...getModel(initialModelKey), key: initialModelKey };
        } catch {
          return null;
        }
      })()
    : null;

  const [view, setView] = useState(hasAnyApiKey() ? 'welcome' : 'setup');
  const [mode, setMode] = useState(MODES[0]);
  const [modelKey, setModelKey] = useState(initialModelKey);
  const [modelConfig, setModelConfig] = useState(initialModelConfig);
  const [modelDisplay, setModelDisplay] = useState(getModelDisplay(initialModelKey));
  const [setupTargetModelKey, setSetupTargetModelKey] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessions, setSessions] = useState([]);
  const [lastSessionTitle, setLastSessionTitle] = useState('');
  const [chatInstanceKey, setChatInstanceKey] = useState(0);

  const resolveModel = useCallback((key) => {
    try {
      const config = getModel(key);
      return { ...config, key };
    } catch {
      return null;
    }
  }, []);

  const currentModel = useMemo(() => (
    modelConfig || {
      key: modelKey,
      name: modelDisplay.label,
      id: modelDisplay.id || '',
      provider: modelDisplay.provider || '',
      providerName: modelDisplay.providerName || '',
      apiKey: '',
      baseURL: '',
      temperature: 1.0,
      topP: 1.0,
      maxTokens: 16384,
      extraParams: {},
    }
  ), [modelConfig, modelDisplay, modelKey]);

  const refreshSessions = useCallback(() => {
    const nextSessions = listSessions();
    const lastSession = getLastSession();
    setSessions(nextSessions);
    setLastSessionTitle(lastSession?.title || '');
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const openSetup = (targetModelKey = null) => {
    setSetupTargetModelKey(targetModelKey);
    setView('setup');
  };

  const applyModelSelection = (selectedKey) => {
    const config = resolveModel(selectedKey);
    if (!config) {
      openSetup(selectedKey);
      return false;
    }

    setModelKey(selectedKey);
    setModelDisplay(getModelDisplay(selectedKey));
    setModelConfig(config);
    return true;
  };

  const applySessionPreferences = useCallback((session) => {
    if (session?.mode?.value) {
      const matchedMode = MODES.find((entry) => entry.value === session.mode.value)
        || MODES.find((entry) => entry.label === session.mode.label);
      if (matchedMode) {
        setMode(matchedMode);
      }
    }

    if (session?.model?.key) {
      const config = resolveModel(session.model.key);
      if (config) {
        setModelKey(session.model.key);
        setModelDisplay(getModelDisplay(session.model.key));
        setModelConfig(config);
      }
    }
  }, [resolveModel]);

  const openSessionById = useCallback((targetSessionId) => {
    const session = loadSession(targetSessionId);
    if (!session) {
      refreshSessions();
      setView('sessions');
      return;
    }

    applySessionPreferences(session);
    setLastActiveSession(session.id);
    setSessionId(session.id);
    setSessionTitle(session.title || 'New Session');
    setChatInstanceKey((value) => value + 1);
    refreshSessions();
    setView('chat');
  }, [applySessionPreferences, refreshSessions]);

  const createAndOpenSession = useCallback(() => {
    setSessionId(null);
    setSessionTitle('New Session');
    setChatInstanceKey((value) => value + 1);
    setView('chat');
  }, []);

  const handleModelSelect = (selected) => {
    if (applyModelSelection(selected.key)) {
      setView('welcome');
    }
  };

  const handleModelChangeInChat = (selected) => {
    applyModelSelection(selected.key);
  };

  const handleModeChangeInChat = (selectedMode) => {
    setMode(selectedMode);
  };

  const handleSessionMetaChange = useCallback((metadata) => {
    if (metadata?.sessionId && metadata.sessionId !== sessionId) {
      setSessionId(metadata.sessionId);
    }
    if (metadata?.title) {
      setSessionTitle(metadata.title);
    }
    refreshSessions();
  }, [refreshSessions, sessionId]);

  const handleRequestSessions = useCallback(() => {
    refreshSessions();
    setView('sessions');
  }, [refreshSessions]);

  const handleChatNewSession = useCallback(() => {
    createAndOpenSession();
  }, [createAndOpenSession]);

  const handleChatExit = useCallback(() => {
    refreshSessions();
    setView('welcome');
  }, [refreshSessions]);

  const handleStartSession = useCallback(() => {
    const lastSession = getLastSession();
    if (lastSession?.id) {
      openSessionById(lastSession.id);
      return;
    }

    createAndOpenSession();
  }, [createAndOpenSession, openSessionById]);

  return (
    <Box>
      {view === 'setup' && (
        <SetupScreen
          modelKey={setupTargetModelKey}
          onComplete={(providerKey) => {
            const nextModelKey = setupTargetModelKey || resolveConfiguredModelKey(providerKey);
            const config = resolveModel(nextModelKey);
            if (config) {
              setModelKey(nextModelKey);
              setModelDisplay(getModelDisplay(nextModelKey));
              setModelConfig(config);
            }
            setSetupTargetModelKey(null);
            setView('welcome');
          }}
        />
      )}

      {view === 'welcome' && (
        <MainMenu
          mode={mode}
          model={{ label: currentModel.name }}
          sessionCount={sessions.length}
          resumeTitle={lastSessionTitle}
          onSelect={(selectedView) => {
            if (selectedView === 'modes') setView('modeSelect');
            else if (selectedView === 'models') setView('modelSelect');
            else if (selectedView === 'chat') {
              const config = resolveModel(modelKey);
              if (config) {
                setModelConfig(config);
                handleStartSession();
              } else {
                openSetup(modelKey);
              }
            } else if (selectedView === 'sessions') {
              refreshSessions();
              setView('sessions');
            } else {
              setView(selectedView);
            }
          }}
        />
      )}

      {view === 'modeSelect' && (
        <ModeSelect
          onBack={() => setView('welcome')}
          onSelect={(selectedMode) => {
            setMode(selectedMode);
            setView('welcome');
          }}
        />
      )}

      {view === 'modelSelect' && (
        <ModelSelect
          onBack={() => setView('welcome')}
          onSelect={handleModelSelect}
        />
      )}

      {view === 'sessions' && (
        <SessionSelect
          sessions={sessions}
          activeSessionId={sessionId}
          onBack={() => {
            refreshSessions();
            setView('welcome');
          }}
          onOpen={openSessionById}
          onRename={async (targetSessionId, newTitle) => {
            renameSession(targetSessionId, newTitle);
            if (targetSessionId === sessionId) {
              setSessionTitle(newTitle);
            }
            refreshSessions();
          }}
          onDelete={async (targetSessionId) => {
            deleteSession(targetSessionId);
            if (targetSessionId === sessionId) {
              setSessionId(null);
              setSessionTitle('');
            }
            refreshSessions();
          }}
          onNewSession={async () => {
            createAndOpenSession();
          }}
        />
      )}

      {view === 'chat' && (
        <ChatScreen
          key={`${sessionId || 'unsaved'}-${chatInstanceKey}`}
          mode={mode}
          model={currentModel}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          availableModes={MODES}
          availableModels={listModels()}
          onModeChange={handleModeChangeInChat}
          onModelChange={handleModelChangeInChat}
          onSessionMetaChange={handleSessionMetaChange}
          onRequestSessions={handleRequestSessions}
          onNewSession={handleChatNewSession}
          onExit={handleChatExit}
        />
      )}

      {view === 'settings' && (
        <SettingsScreen onBack={() => setView('welcome')} />
      )}
    </Box>
  );
};

export default App;
