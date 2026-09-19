// Only Discord's Unknown Channel error proves a channel is gone. Permission
// errors and temporary network failures must leave persisted mappings intact.
export async function fetchChannel(manager, id) {
  try {
    return await manager.fetch(id);
  } catch (err) {
    if (err.code === 10003) return null;
    throw err;
  }
}

export async function deleteChannel(channel) {
  try {
    await channel.delete();
  } catch (err) {
    if (err.code !== 10003) throw err;
  }
}
