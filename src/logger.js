const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;

function log(level, context, message, data) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    ctx: context,
    msg: message,
    ...(data && { data }),
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export default {
  debug: (ctx, msg, data) => log('debug', ctx, msg, data),
  info: (ctx, msg, data) => log('info', ctx, msg, data),
  warn: (ctx, msg, data) => log('warn', ctx, msg, data),
  error: (ctx, msg, data) => log('error', ctx, msg, data),
};
