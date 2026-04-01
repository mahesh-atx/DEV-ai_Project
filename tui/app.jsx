import React, { useState } from 'react';
import { Box } from 'ink';
import MainMenu from './components/MainMenu.jsx';
import ModeSelect from './components/ModeSelect.jsx';
import ModelSelect from './components/ModelSelect.jsx';
import ChatScreen from './components/ChatScreen.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import { MODES } from './constants.js';
import { listModels, getModel } from '../config/models.js';

const App = () => {
  const [view, setView] = useState('welcome');
  const [mode, setMode] = useState(MODES[0]);
  const [modelKey, setModelKey] = useState('kimi');
  const [modelConfig, setModelConfig] = useState(null);
  const [modelDisplay, setModelDisplay] = useState({ label: 'Moonshot Kimi-k2.5' });

  const resolveModel = (key) => {
    try {
      const config = getModel(key);
      return config;
    } catch (e) {
      return null;
    }
  };

  const handleModelSelect = (selected) => {
    setModelKey(selected.key);
    setModelDisplay({ label: selected.name });
    const config = resolveModel(selected.key);
    if (config) setModelConfig(config);
    setView('welcome');
  };

  const currentModel = modelConfig || {
    name: modelDisplay.label,
    id: 'moonshotai/kimi-k2.5',
    apiKey: process.env.NVIDIA_API_KEY || '',
    temperature: 1.0,
    topP: 1.0,
    maxTokens: 16384,
    extraParams: {},
  };

  return (
    <Box>
      {view === 'welcome' && (
        <MainMenu
          mode={mode}
          model={{ label: currentModel.name }}
          onSelect={(v) => {
            if (v === 'modes') setView('modeSelect');
            else if (v === 'models') setView('modelSelect');
            else if (v === 'chat') {
              const config = resolveModel(modelKey);
              if (config) setModelConfig(config);
              setView('chat');
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
