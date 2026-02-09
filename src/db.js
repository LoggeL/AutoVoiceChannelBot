const knex = require('knex');
const log = require('./logger');

let db;

async function init() {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: './db.sqlite3' },
    useNullAsDefault: true,
  });

  if (!(await db.schema.hasTable('guildSetting'))) {
    await db.schema.createTable('guildSetting', (t) => {
      t.increments('id').primary();
      t.string('guild');
      t.boolean('textChannel').defaultTo(false);
    });
    log.info('db', 'Created guildSetting table');
  }

  if (!(await db.schema.hasTable('textIDs'))) {
    await db.schema.createTable('textIDs', (t) => {
      t.increments('id').primary();
      t.string('voiceChannel');
      t.string('textChannel');
    });
    log.info('db', 'Created textIDs table');
  }

  return db;
}

async function getGuildSettings() {
  return db('guildSetting').select('*');
}

async function insertGuildSetting(guildId, textChannel) {
  await db('guildSetting').insert({ guild: guildId, textChannel });
}

async function updateGuildSetting(guildId, textChannel) {
  await db('guildSetting').where('guild', guildId).update({ textChannel });
}

async function getTextIDs() {
  return db('textIDs').select('*');
}

async function insertTextID(voiceChannel, textChannel) {
  await db('textIDs').insert({ voiceChannel, textChannel });
}

async function deleteTextID(voiceChannel) {
  await db('textIDs').where('voiceChannel', voiceChannel).del();
}

async function deleteTextIDByBoth(voiceChannel, textChannel) {
  await db('textIDs').where({ voiceChannel, textChannel }).del();
}

async function destroy() {
  if (db) await db.destroy();
}

module.exports = {
  init,
  getGuildSettings,
  insertGuildSetting,
  updateGuildSetting,
  getTextIDs,
  insertTextID,
  deleteTextID,
  deleteTextIDByBoth,
  destroy,
};
