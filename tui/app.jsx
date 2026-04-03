import React, { useState } from 'react';
import { Box } from 'ink';
import MainMenu from './components/MainMenu.jsx';
import ModeSelect from './components/ModeSelect.jsx';
import ModelSelect from './components/ModelSelect.jsx';
import ChatScreen from './components/ChatScreen.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import SetupScreen from './components/SetupScreen.jsx';
import { MODES } from './constants.js';
import { listModels, getModel } from '../config/models.js';
import { hasAnyApiKey } from '../utils/configManager.js';

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

  const resolveModel = (key) => {
    try {
      const config = getModel(key);
      return { ...config, key };
    } catch (e) {
      return null;
    }
  };

  const openSetup = (targetModelKey = null) => {
    setSetupTargetModelKey(targetModelKey);
    setView('setup');
  };

  const applyModelSelection = (selectedKey, selectedName) => {
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

  const handleModelSelect = (selected) => {
    if (applyModelSelection(selected.key, selected.name)) {
      setView('welcome');
    }
  };

  const handleModelChangeInChat = (selected) => {
    applyModelSelection(selected.key, selected.name);
  };

  const handleModeChangeInChat = (selectedMode) => {
    setMode(selectedMode);
  };

  const currentModel = modelConfig || {
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
  };

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
          onSelect={(v) => {
            if (v === 'modes') setView('modeSelect');
            else if (v === 'models') setView('modelSelect');
            else if (v === 'chat') {
              const config = resolveModel(modelKey);
              if (config) {
                setModelConfig(config);
                setView('chat');
              } else {
                openSetup(modelKey);
              }
            }
            else setView(v);
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

      {view === 'chat' && (
        <ChatScreen
          mode={mode}
          model={currentModel}
          availableModes={MODES}
          availableModels={listModels()}
          onModeChange={handleModeChangeInChat}
          onModelChange={handleModelChangeInChat}
          onExit={() => setView('welcome')}
        />
      )}

      {view === 'settings' && (
        <SettingsScreen onBack={() => setView('welcome')} />
      )}
    </Box>
  );
};

export default App;
