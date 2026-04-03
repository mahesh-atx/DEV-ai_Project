import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
export const TODO_PRIORITIES = ['high', 'medium', 'low'];

function sanitizeTodoValue(value, fallback = '') {
  return String(value == null ? fallback : value).replace(/\s+/g, ' ').trim();
}

export function normalizeTodoItem(todo) {
  if (!todo || typeof todo !== 'object') return null;

  const content = sanitizeTodoValue(todo.content);
  if (!content) return null;

  const status = TODO_STATUSES.includes(todo.status) ? todo.status : 'pending';
  const priority = TODO_PRIORITIES.includes(todo.priority) ? todo.priority : 'medium';

  return { content, status, priority };
}

export function normalizeTodoList(todos) {
  if (!Array.isArray(todos)) return [];
  return todos.map(normalizeTodoItem).filter(Boolean);
}

export function getTodoCounts(todos) {
  const list = normalizeTodoList(todos);
  return list.reduce((counts, todo) => {
    counts.total += 1;
    counts[todo.status] += 1;
    return counts;
  }, {
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  });
}

export function getTodosPath(projectRoot = process.cwd()) {
  return join(projectRoot, '.kilo', 'todos.json');
}

export function readTodoList(projectRoot = process.cwd()) {
  const todosPath = getTodosPath(projectRoot);
  if (!existsSync(todosPath)) return [];

  const raw = readFileSync(todosPath, 'utf-8');
  return normalizeTodoList(JSON.parse(raw));
}

export function writeTodoList(projectRoot = process.cwd(), todos) {
  const normalizedTodos = normalizeTodoList(todos);
  const todosPath = getTodosPath(projectRoot);
  mkdirSync(join(projectRoot, '.kilo'), { recursive: true });
  writeFileSync(todosPath, JSON.stringify(normalizedTodos, null, 2));
  return normalizedTodos;
}
