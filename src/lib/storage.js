import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Generic KV ───────────────────────────────────────────────────────────────
export async function storeGet(key) {
  const { data, error } = await supabase
    .from('kv')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return null;
  return data.value;
}

export async function storeSet(key, value) {
  const { error } = await supabase
    .from('kv')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('storeSet error', key, error.message);
}

// ─── MMR profiles ─────────────────────────────────────────────────────────────
export async function getMMR(playerId) {
  const { data } = await supabase
    .from('mmr_profiles')
    .select('data')
    .eq('player_id', playerId)
    .maybeSingle();
  return data?.data ?? null;
}

export async function setMMR(playerId, profile) {
  const { error } = await supabase
    .from('mmr_profiles')
    .upsert({ player_id: playerId, data: profile, updated_at: new Date().toISOString() }, { onConflict: 'player_id' });
  if (error) console.error('setMMR error', error.message);
}

// ─── Post image upload ─────────────────────────────────────────────────────────
export async function uploadPostImage(file) {
  const ext = file.name.split('.').pop();
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('post-images')
    .upload(path, file, { upsert: false });
  if (error) { console.error('upload error', error.message); return null; }
  const { data } = supabase.storage.from('post-images').getPublicUrl(path);
  return data.publicUrl;
}

// ─── Realtime subscription ────────────────────────────────────────────────────
export function subscribeKV(key, callback) {
  const channel = supabase
    .channel(`kv:${key}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'kv', filter: `key=eq.${key}` },
      (payload) => {
        const row = payload.new;
        if (row?.value !== undefined) callback(row.value);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}