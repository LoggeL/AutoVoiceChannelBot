import knex from 'knex';
import log from './logger.js';

let db;

export async function init(filename = process.env.DATABASE_PATH || './db.sqlite3') {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename },
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

  // Existing installations may have duplicate rows. Keep the last saved value
  // before adding the indexes needed for atomic upserts.
  await db.transaction(async (trx) => {
    for (const [table, column] of [['guildSetting', 'guild'], ['textIDs', 'voiceChannel']]) {
      const indexName = `${table}_${column}_unique`;
      const exists = await trx('sqlite_master').where({ type: 'index', name: indexName }).first('name');
      if (exists) continue;
      await trx(table).whereNotIn('id', trx(table).max('id').groupBy(column)).del();
      await trx.schema.alterTable(table, t => t.unique([column], indexName));
    }
  });

  return db;
}

export async function getGuildSettings() {
  return db('guildSetting').select('guild', 'textChannel');
}

export async function updateGuildSetting(guildId, textChannel) {
  await db('guildSetting').insert({ guild: guildId, textChannel })
    .onConflict('guild').merge({ textChannel });
}

export async function getTextIDs() {
  return db('textIDs').select('voiceChannel', 'textChannel');
}

export async function insertTextID(voiceChannel, textChannel) {
  await db('textIDs').insert({ voiceChannel, textChannel })
    .onConflict('voiceChannel').merge({ textChannel });
}

export async function deleteTextID(voiceChannel) {
  await db('textIDs').where('voiceChannel', voiceChannel).del();
}

export async function destroy() {
  if (db) await db.destroy();
  db = undefined;
}
