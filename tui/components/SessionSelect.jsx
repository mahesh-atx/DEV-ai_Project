import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { THEME } from '../constants.js';

function truncate(text, max = 68) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return 'No messages yet';
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'unknown time';

  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(isoString).toLocaleDateString();
}

const SessionSelect = ({
  sessions = [],
  activeSessionId = null,
  onBack,
  onOpen,
  onRename,
  onDelete,
  onNewSession,
}) => {
  const [screen, setScreen] = useState('list');
  const [selectedSession, setSelectedSession] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [message, setMessage] = useState('');

  useInput((input, key) => {
    if (!key.escape) return;

    setMessage('');

    if (screen === 'rename' || screen === 'delete' || screen === 'actions') {
      setScreen('list');
      return;
    }

    if (screen === 'list') {
      onBack();
    }
  });

  const listItems = useMemo(() => ([
    ...sessions.map((session) => ({
      label: session.title || 'New Session',
      value: session.id,
      key: `session-${session.id}`,
      session,
    })),
    { label: '+ New Session', value: 'new', key: 'new' },
    { label: '< Back', value: 'back', key: 'back' },
  ]), [sessions]);

  const actionItems = useMemo(() => ([
    { label: 'Open', value: 'open' },
    { label: 'Rename', value: 'rename' },
    { label: 'Delete', value: 'delete' },
    { label: 'Back', value: 'back' },
  ]), []);

  const confirmDeleteItems = useMemo(() => ([
    { label: 'Keep Session', value: 'cancel' },
    { label: 'Delete Permanently', value: 'delete' },
  ]), []);

  const handleListSelect = async (item) => {
    setMessage('');

    if (item.value === 'back') {
      onBack();
      return;
    }

    if (item.value === 'new') {
      await onNewSession();
      return;
    }

    setSelectedSession(item.session);
    setRenameValue(item.session?.title || '');
    setScreen('actions');
  };

  const handleActionSelect = async (item) => {
    if (!selectedSession) {
      setScreen('list');
      return;
    }

    if (item.value === 'back') {
      setScreen('list');
      return;
    }

    if (item.value === 'open') {
      await onOpen(selectedSession.id);
      return;
    }

    if (item.value === 'rename') {
      setRenameValue(selectedSession.title || '');
      setScreen('rename');
      return;
    }

    if (item.value === 'delete') {
      if (selectedSession.id === activeSessionId) {
        setMessage('Switch away from the active session before deleting it.');
        setScreen('list');
        return;
      }

      setScreen('delete');
    }
  };

  const handleRenameSubmit = async (value) => {
    if (!selectedSession) {
      setScreen('list');
      return;
    }

    const nextTitle = value.trim();
    if (!nextTitle) {
      setMessage('Session title cannot be empty.');
      return;
    }

    await onRename(selectedSession.id, nextTitle);
    setMessage('Session renamed.');
    setSelectedSession((previous) => previous ? { ...previous, title: nextTitle } : previous);
    setScreen('list');
  };

  const handleDeleteSelect = async (item) => {
    if (item.value === 'cancel' || !selectedSession) {
      setScreen('list');
      return;
    }

    await onDelete(selectedSession.id);
    setMessage('Session deleted.');
    setSelectedSession(null);
    setScreen('list');
  };

  const renderSessionRow = ({ isSelected, label, value }) => {
    if (value === 'new' || value === 'back') {
      return (
        <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
          {label}
        </Text>
      );
    }

    const session = sessions.find((entry) => entry.id === value);
    if (!session) {
      return (
        <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
          {label}
        </Text>
      );
    }
    const isActive = session.id === activeSessionId;
    const title = `${isActive ? '* ' : ''}${session.title || 'New Session'}${isActive ? ' (active)' : ''}`;
    const meta = `${session.mode || 'Unknown'}  |  ${session.messageCount || 0} msgs  |  ${formatRelativeTime(session.updatedAt)}`;

    return (
      <Box flexDirection="column">
        <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
          {title}
        </Text>
        <Text color={THEME.dim}>{meta}</Text>
        <Text color={THEME.dim}>{truncate(session.lastMessagePreview)}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={92}>
        <Text color={THEME.accent} bold>
          {screen === 'list' ? 'Sessions' : selectedSession?.title || 'Session'}
        </Text>

        {message ? (
          <Box marginTop={1}>
            <Text color={THEME.warning}>{message}</Text>
          </Box>
        ) : null}

        {screen === 'list' && (
          <Box marginTop={1} flexDirection="column">
            <Text color={THEME.dim}>
              {sessions.length > 0 ? `${sessions.length} saved sessions` : 'No saved sessions yet'}
            </Text>
            <Box marginTop={1}>
              <SelectInput
                items={listItems}
                onSelect={handleListSelect}
                indicatorComponent={({ isSelected }) => (
                  <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '> ' : '  '}</Text>
                )}
                itemComponent={renderSessionRow}
              />
            </Box>
          </Box>
        )}

        {screen === 'actions' && selectedSession && (
          <Box marginTop={1} flexDirection="column">
            <Text color={THEME.dim}>{truncate(selectedSession.lastMessagePreview)}</Text>
            <Box marginTop={1}>
              <SelectInput
                items={actionItems}
                onSelect={handleActionSelect}
                indicatorComponent={({ isSelected }) => (
                  <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '> ' : '  '}</Text>
                )}
                itemComponent={({ isSelected, label }) => (
                  <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                    {label}
                  </Text>
                )}
              />
            </Box>
          </Box>
        )}

        {screen === 'rename' && selectedSession && (
          <Box marginTop={1} flexDirection="column">
            <Text color={THEME.text}>Enter a new title and press Enter:</Text>
            <Box marginTop={1}>
              <TextInput
                value={renameValue}
                onChange={(value) => {
                  setRenameValue(value);
                  setMessage('');
                }}
                onSubmit={handleRenameSubmit}
                focus
                showCursor
              />
            </Box>
            <Box marginTop={1}>
              <Text color={THEME.dim}>Esc returns to the session list.</Text>
            </Box>
          </Box>
        )}

        {screen === 'delete' && selectedSession && (
          <Box marginTop={1} flexDirection="column">
            <Text color={THEME.warning}>
              Delete "{selectedSession.title || 'New Session'}"?
            </Text>
            <Text color={THEME.dim}>This removes its saved chat history from .rootx/sessions.</Text>
            <Box marginTop={1}>
              <SelectInput
                items={confirmDeleteItems}
                onSelect={handleDeleteSelect}
                indicatorComponent={({ isSelected }) => (
                  <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '> ' : '  '}</Text>
                )}
                itemComponent={({ isSelected, label }) => (
                  <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                    {label}
                  </Text>
                )}
              />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SessionSelect;
