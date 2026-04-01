function callHandler(handlers, key, payload) {
  const handler = handlers?.[key];
  if (typeof handler === 'function') {
    handler(payload);
  }
}

export function createTuiReporter(handlers = {}) {
  return {
    mode: 'tui',
    silent: true,
    phaseHeader(payload) {
      callHandler(handlers, 'phaseHeader', payload);
    },
    phaseStatus(payload) {
      callHandler(handlers, 'phaseStatus', payload);
    },
    toolExecution(payload) {
      callHandler(handlers, 'toolExecution', payload);
    },
    toolResult(payload) {
      callHandler(handlers, 'toolResult', payload);
    },
    fileChange(payload) {
      callHandler(handlers, 'fileChange', payload);
    },
    commandPreview(payload) {
      callHandler(handlers, 'commandPreview', payload);
    },
    commandResult(payload) {
      callHandler(handlers, 'commandResult', payload);
    },
    summary(payload) {
      callHandler(handlers, 'summary', payload);
    },
    log(payload) {
      callHandler(handlers, 'log', payload);
    },
  };
}

export default createTuiReporter;
