import fs from 'fs';
import path from 'path';

const SESSIONS_DIR_NAME = '.rootx/sessions';
const INDEX_FILE = 'index.json';

export function getSessionsDir(projectDir = process.cwd()) {
  const dir = path.join(projectDir, SESSIONS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getIndexFilePath(projectDir) {
  return path.join(getSessionsDir(projectDir), INDEX_FILE);
}

function loadIndex(projectDir) {
  try {
    const raw = fs.readFileSync(getIndexFilePath(projectDir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastActiveSessionId: null, sessions: [] };
  }
}

function saveIndex(index, projectDir) {
  fs.writeFileSync(getIndexFilePath(projectDir), JSON.stringify(index, null, 2), 'utf8');
}

export function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function generateSmartTitle(firstUserMessage) {
  if (!firstUserMessage || typeof firstUserMessage !== 'string') {
    return 'New Session';
  }
  
  const words = firstUserMessage.trim().split(/\s+/);
  const titleWords = words.slice(0, 6);
  let title = titleWords.join(' ');
  
  if (title.length > 50) {
    title = title.substring(0, 47) + '...';
  }
  
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  
  return title || 'New Session';
}

function normalizeTitle(title) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed || 'New Session';
}

export function createSession({ mode, model, projectDir = process.cwd(), title = null }) {
  const id = generateSessionId();
  const now = new Date().toISOString();
  const session = {
    id,
    title: normalizeTitle(title),
    createdAt: now,
    updatedAt: now,
    mode: mode ? { value: mode.value, label: mode.label } : null,
    model: model ? { key: model.key, name: model.name } : null,
    messages: [{ type: 'system', text: 'RootX Workspace initialized.', id: 'init' }],
    activityLog: [],
    summary: {
      filesCreated: 0,
      filesEdited: 0,
      commandsRun: 0,
      errors: 0,
      duration: '0.0s',
      loopCount: 0,
    },
    customBuildCmd: '',
    lastCheckpoint: null,
  };
  saveSession(session, projectDir);
  return session;
}

export function saveSession(session, projectDir = process.cwd()) {
  const sessionsDir = getSessionsDir(projectDir);
  const filePath = path.join(sessionsDir, `${session.id}.json`);
  const nextSession = {
    ...session,
    title: normalizeTitle(session.title),
    updatedAt: new Date().toISOString(),
    messages: Array.isArray(session.messages) ? session.messages : [],
    activityLog: Array.isArray(session.activityLog) ? session.activityLog : [],
  };
  fs.writeFileSync(filePath, JSON.stringify(nextSession, null, 2), 'utf8');
  updateIndex(nextSession, projectDir);
  return nextSession;
}

function updateIndex(session, projectDir) {
  const index = loadIndex(projectDir);
  const existingIndex = index.sessions.findIndex((s) => s.id === session.id);
  const entry = {
    id: session.id,
    title: session.title || 'New Session',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    mode: session.mode?.label || 'Unknown',
    model: session.model?.name || 'Unknown',
    messageCount: session.messages?.length || 0,
    lastMessagePreview: getLastMessagePreview(session.messages),
  };
  if (existingIndex >= 0) {
    index.sessions[existingIndex] = entry;
  } else {
    index.sessions.push(entry);
  }
  index.sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  index.lastActiveSessionId = session.id;
  saveIndex(index, projectDir);
}

function getLastMessagePreview(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'user' || msg.type === 'assistant') {
      const text = (msg.text || '').replace(/\n/g, ' ').trim();
      return text.length > 80 ? text.substring(0, 77) + '...' : text;
    }
  }
  return 'No messages yet';
}

export function loadSession(sessionId, projectDir = process.cwd()) {
  const sessionsDir = getSessionsDir(projectDir);
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function listSessions(projectDir = process.cwd()) {
  const index = loadIndex(projectDir);
  return index.sessions || [];
}

export function deleteSession(sessionId, projectDir = process.cwd()) {
  const sessionsDir = getSessionsDir(projectDir);
  const filePath = path.join(sessionsDir, `${sessionId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  const index = loadIndex(projectDir);
  index.sessions = index.sessions.filter((s) => s.id !== sessionId);
  if (index.lastActiveSessionId === sessionId) {
    index.lastActiveSessionId = index.sessions.length > 0 ? index.sessions[0].id : null;
  }
  saveIndex(index, projectDir);
  return true;
}

export function renameSession(sessionId, newTitle, projectDir = process.cwd()) {
  const session = loadSession(sessionId, projectDir);
  if (!session) return false;
  session.title = normalizeTitle(newTitle);
  saveSession(session, projectDir);
  return true;
}

export function getLastSession(projectDir = process.cwd()) {
  const index = loadIndex(projectDir);
  if (!index.lastActiveSessionId || index.sessions.length === 0) {
    return null;
  }
  return loadSession(index.lastActiveSessionId, projectDir);
}

export function setLastActiveSession(sessionId, projectDir = process.cwd()) {
  const index = loadIndex(projectDir);
  index.lastActiveSessionId = sessionId;
  saveIndex(index, projectDir);
}
