export const BUILTIN_RECRUITING_CHANNELS = [
  ['内推', 'employee_ref'], ['猎聘', 'job_board'], ['BOSS直聘', 'job_board'], ['其他', 'other']
]

export function migrateRecruitingChannels(connection) {
  for (const [name, type] of BUILTIN_RECRUITING_CHANNELS) {
    connection.prepare('INSERT INTO recruiting_channels(name,type) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM recruiting_channels WHERE name=?)').run(name,type,name)
    connection.prepare(`UPDATE candidates SET source_channel_id=(SELECT MIN(id) FROM recruiting_channels WHERE name=?)
      WHERE source_channel_id IS NULL AND source_channel=? AND (SELECT COUNT(*) FROM recruiting_channels WHERE name=?)=1`).run(name,name,name)
  }
}

// An explicit channel identity wins. Historical text-only sources match a unique exact name.
export function candidateChannel(candidate, channels) {
  if (candidate.source_channel_id != null && candidate.source_channel_id !== '') return channels.find(channel => channel.id === Number(candidate.source_channel_id)) || null
  const matches = channels.filter(channel => channel.name === candidate.source_channel)
  return matches.length === 1 ? matches[0] : null
}
