'use strict';
const path = require('path');
const { readJson, atomicWrite } = require('./util');

const LOG_LIMIT = 300;

class Store {
  constructor(dir) {
    this.dir = dir;
    this.files = {
      config: path.join(dir, 'config.json'),
      history: path.join(dir, 'history.json'),
      state: path.join(dir, 'state.json'),
    };
    this.config = readJson(this.files.config, { auth: null, bots: [] });
    this.history = readJson(this.files.history, {});
    this.state = readJson(this.files.state, {});
    this.logs = new Map();
  }

  saveConfig() { atomicWrite(this.files.config, JSON.stringify(this.config, null, 2)); }
  saveHistory() { atomicWrite(this.files.history, JSON.stringify(this.history)); }
  saveState() { atomicWrite(this.files.state, JSON.stringify(this.state)); }

  get bots() { return this.config.bots; }
  getBot(id) { return this.config.bots.find((b) => b.id === id); }
  findByToken(token) { return this.config.bots.find((b) => b.inviteToken === token); }

  addBot(bot) {
    this.config.bots.push(bot);
    this.saveConfig();
  }

  removeBot(id) {
    this.config.bots = this.config.bots.filter((b) => b.id !== id);
    delete this.history[id];
    delete this.state[id];
    this.logs.delete(id);
    this.saveConfig();
    this.saveHistory();
    this.saveState();
  }

  hist(id) {
    return (this.history[id] ||= { seen: {}, recent: [] });
  }

  st(id) {
    return (this.state[id] ||= {
      nextRunAt: 0,
      kwCursor: 0,
      pageCursor: {},
      stats: { posted: 0, cycles: 0, errors: 0, lastRunAt: 0, lastPostAt: 0, lastError: '' },
    });
  }

  log(id, level, msg) {
    const arr = this.logs.get(id) || [];
    arr.push({ t: Date.now(), level, msg: String(msg) });
    if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT);
    this.logs.set(id, arr);
    if (process.env.QUIET !== '1') console.log(`[${new Date().toISOString()}] [${id}] ${level.toUpperCase()} ${msg}`);
  }
}

module.exports = { Store };
