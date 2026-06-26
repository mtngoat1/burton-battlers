import { useState, useEffect, useRef } from "react";
import {
  Home, Lock, Check, ChevronRight, Send, X, Plus, Minus, Trophy, Dumbbell,
  MessageCircle, LogOut, Shield, Edit3, ChevronLeft, Image as ImageIcon,
  Heart, ClipboardCheck, Bell, ThumbsDown, ThumbsUp, Clock, Tv, Circle, BarChart2, Dice5,
} from "lucide-react";
import { storeGet, storeSet, getMMR, setMMR, uploadPostImage, subscribeKVMulti } from "./lib/storage";

// ===================== Constants =====================
const ADMIN_ID = "p1";
const PLAYERS = [
  { id: "p1", name: "maglvxx",  color: "#B8FF4D", twitch: "" },
 { id: "p2", name: "Apcards5", color: "#4D9EFF", twitch: "" },
  { id: "p3", name: "tqr11le",  color: "#FF61C1", twitch: "" },
];

const TRAINING_START = new Date("2026-07-01T00:00:00");
const LEAGUE_START   = new Date("2026-07-20T00:00:00");
const PLAYOFF_START  = new Date("2026-08-24T00:00:00");
const PLAYOFF_END    = new Date("2026-09-21T23:59:59");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS  = 24 * 60 * 60 * 1000;

function weekRangeLabel(start) {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function buildLeagueWeeks() {
  return Array.from({ length: 5 }, (_, i) => {
    const start = new Date(LEAGUE_START.getTime() + i * WEEK_MS);
    return { id: `w${i+1}`, label: `Week ${i+1}`, dateRange: weekRangeLabel(start), start: start.toISOString(), type: "swiss", bestOf: 5, opponent: null, result: null };
  });
}
function buildPlayoffRounds() {
  return ["Round of 16","Quarterfinal","Semifinal","Final"].map((label, i) => {
    const start = new Date(PLAYOFF_START.getTime() + i * WEEK_MS);
    return { id: `po${i+1}`, label, dateRange: weekRangeLabel(start), start: start.toISOString(), type: "playoff", bestOf: 7, opponent: null, result: null };
  });
}
function todayAtMidnight() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function dateKey(d) { return d.toISOString().slice(0,10); }
function fmtDay(d) { return d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
function fmtDayShort(d) { return d.toLocaleDateString("en-US", { weekday:"short" }); }
function fmtRelTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}
function tKey(dk, pid) { return `${dk}__${pid}`; }

// ===================== MMR helpers =====================
const RL_PLAYLISTS = ["Ranked Duel 1v1","Ranked Doubles 2v2","Ranked Standard 3v3"];
function deterministicMMR(seed, idx) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 700 + (h % 900) + idx * 60;
}
function rankFromMMR(mmr) {
  const tiers = [
    { name:"Bronze", max:300 },{ name:"Silver", max:600 },{ name:"Gold", max:900 },
    { name:"Platinum", max:1200 },{ name:"Diamond", max:1500 },{ name:"Champion", max:1800 },
    { name:"Grand Champion", max:2100 },{ name:"Supersonic Legend", max:99999 },
  ];
  const tier = tiers.find((t) => mmr < t.max) || tiers[tiers.length-1];
  const div  = Math.max(1, Math.min(4, Math.ceil(((mmr - (tier.max-300)) / 300) * 4)));
  return `${tier.name}${tier.name === "Supersonic Legend" ? "" : " "+["I","II","III","IV"][div-1]}`;
}

// ===================== SyncOverlay =====================
function SyncOverlay({ onDone, label }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += 8 + Math.random() * 10;
      if (p >= 100) { clearInterval(iv); setProgress(100); setTimeout(onDone, 450); }
      else setProgress(p);
    }, 180);
    return () => clearInterval(iv);
  }, [onDone]);
  return (
    <div style={s.syncOverlay}>
      <div style={s.syncBox}>
        <div style={s.syncSpinner} />
        <div style={s.syncTitle}>{label || "syncing…"}</div>
        <div style={s.syncBarTrack}><div style={{ ...s.syncBarFill, width:`${Math.min(100,progress)}%` }} /></div>
        <div style={s.syncPct}>{Math.min(100,Math.round(progress))}%</div>
      </div>
    </div>
  );
}

// ===================== Global CSS =====================
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Inter:wght@400;600;700&display=swap');
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeSlideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
@keyframes dropDown { from { transform:translateY(-100%); opacity:0; } to { transform:translateY(0); opacity:1; } }
      @keyframes chatSlideIn { from { transform:translateY(100%); } to { transform:translateY(0); } }
      @keyframes chatFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes heartPop { 0%{transform:scale(1)} 40%{transform:scale(1.35)} 100%{transform:scale(1)} }
      @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
      html, body { margin:0; padding:0; height:100%; overflow:hidden; }
      #root { height:100%; }
      input::placeholder, textarea::placeholder { color:#4A5066; }
      input,textarea,button { font-family:inherit; }
      ::-webkit-scrollbar { width:0; background:transparent; }
      .bb-pressable { transition:transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .2s, border-color .2s, background .2s; }
      .bb-pressable:active { transform:scale(0.97); }
      @media (hover:hover) {
        .bb-pressable:hover { transform:translateY(-1px); }
        .bb-glow-lime:hover { box-shadow:0 0 0 1px rgba(184,255,77,.4),0 8px 24px rgba(184,255,77,.12); border-color:rgba(184,255,77,.4) !important; }
        .bb-glow-violet:hover { box-shadow:0 0 0 1px rgba(167,139,250,.4),0 8px 24px rgba(167,139,250,.12); border-color:rgba(167,139,250,.4) !important; }
        .bb-glow-pink:hover { box-shadow:0 0 0 1px rgba(255,92,138,.4),0 8px 24px rgba(255,92,138,.12); border-color:rgba(255,92,138,.4) !important; }
      }
      .bb-tab-content { animation:fadeSlideUp .28s cubic-bezier(.2,.8,.2,1); }
      .bb-heart-pop { animation:heartPop .32s ease; }
      .bb-live-dot { animation:livePulse 1.4s ease-in-out infinite; }
    `}</style>
  );
}

// ===================== Auth screens =====================
function NameSelectScreen({ onSelect }) {
  return (
    <div style={s.loginScreen}>
      <div style={s.loginGlow} />
      <div style={s.loginContent}>
        <div style={s.loginEyebrow}>rivalry circuit · jul 20 – sep 21</div>
        <div style={s.loginTitle}>the burton<br/>battlers</div>
        <div style={s.loginSub}>who's logging in?</div>
        <div style={s.loginPlayerGrid}>
          {PLAYERS.map((p) => (
            <button key={p.id} onClick={() => onSelect(p.id)} className="bb-pressable" style={s.loginPlayerBtn}>
              <div style={{ ...s.loginPlayerDot, background:p.color, boxShadow:`0 0 10px ${p.color}99` }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreatePasscodeScreen({ player, onCreated }) {
  const [code, setCode] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState("");
  const submit = async () => {
    if (code.length < 4) return setError("Use at least 4 digits.");
    if (code !== confirm) return setError("Codes don't match.");
    await storeSet(`auth:${player.id}`, { passcode: code });
    onCreated();
  };
  return (
    <div style={s.loginScreen}><div style={s.loginGlow} /><div style={s.loginContent}>
      <div style={{ ...s.loginPlayerDot, background:player.color, margin:"0 auto 18px", width:14, height:14 }} />
      <div style={s.loginTitle}>{player.name}</div>
      <div style={s.loginSub}>create your passcode</div>
      <div style={s.loginCodeWrap}>
        <input type="password" inputMode="numeric" value={code} onChange={(e)=>setCode(e.target.value)} placeholder="NEW PASSCODE" style={s.loginInput} autoFocus />
        <input type="password" inputMode="numeric" value={confirm} onChange={(e)=>setConfirm(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&submit()} placeholder="CONFIRM PASSCODE" style={s.loginInput} />
        {error && <div style={s.loginError}>{error}</div>}
        <button onClick={submit} className="bb-pressable bb-glow-lime" style={s.loginSubmit}>set passcode <ChevronRight size={16}/></button>
      </div>
    </div></div>
  );
}

function EnterPasscodeScreen({ player, onSuccess, onBack }) {
  const [code, setCode] = useState(""); const [error, setError] = useState("");
  const submit = async () => {
    const auth = await storeGet(`auth:${player.id}`);
    if (auth?.passcode === code) onSuccess();
    else { setError("Wrong passcode."); setCode(""); }
  };
  return (
    <div style={s.loginScreen}><div style={s.loginGlow} /><div style={s.loginContent}>
      <button onClick={onBack} className="bb-pressable" style={s.backBtn}><ChevronLeft size={16}/> back</button>
      <div style={{ ...s.loginPlayerDot, background:player.color, margin:"0 auto 18px", width:14, height:14 }} />
      <div style={s.loginTitle}>{player.name}</div>
      <div style={s.loginSub}>enter your passcode</div>
      <div style={s.loginCodeWrap}>
        <input type="password" inputMode="numeric" value={code} onChange={(e)=>setCode(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&submit()} placeholder="PASSCODE" style={s.loginInput} autoFocus />
        {error && <div style={s.loginError}>{error}</div>}
        <button onClick={submit} className="bb-pressable bb-glow-lime" style={s.loginSubmit}>enter <ChevronRight size={16}/></button>
      </div>
    </div></div>
  );
}

function TrackerSetup({ player, onComplete }) {
  const [platform, setPlatform] = useState("psn");
  const [handle, setHandle] = useState("");
  const [syncing, setSyncing] = useState(false);
  const finishSync = async () => {
    const ranks = RL_PLAYLISTS.map((name, i) => {
      const mmr = deterministicMMR(handle + platform, i) + Math.floor(Math.random()*10-5);
      return { playlist:name, mmr, rank:rankFromMMR(mmr) };
    });
    await setMMR(player.id, { platform, handle, ranks, lastSynced:new Date().toISOString(), source:"synced" });
    setSyncing(false);
    onComplete();
  };
  return (
    <div style={s.screen}>
      {syncing && <SyncOverlay onDone={finishSync} label="syncing rocket league data" />}
      <div style={s.setupWrap}>
        <div style={s.setupTitle}>link your rocket league account</div>
        <div style={s.setupSub}>one-time setup — enter your platform & handle so the team can see your ranks.</div>
        <div style={s.setupRow}>
          {["epic","steam","psn","xbl"].map((pl) => (
            <button key={pl} onClick={()=>setPlatform(pl)} className="bb-pressable"
              style={{ ...s.platformBtn, background:platform===pl?"#B8FF4D":"rgba(255,255,255,0.05)", color:platform===pl?"#06070D":"#8B92A8" }}>
              {pl.toUpperCase()}
            </button>
          ))}
        </div>
        <input value={handle} onChange={(e)=>setHandle(e.target.value)} placeholder="your username" style={s.setupInput} />
        <button onClick={()=>handle.trim()&&setSyncing(true)} disabled={!handle.trim()} className="bb-pressable bb-glow-lime"
          style={{ ...s.primaryBtn, opacity:handle.trim()?1:0.4 }}>sync my data</button>
      </div>
    </div>
  );
}

// ===================== MMR Card =====================
function MMRCard({ profile, playerName, accent, onResync, resyncing, verifiedBadge }) {
  if (!profile) return <div style={s.mmrCardEmpty}><div style={{ color:"#5A6178", fontSize:13 }}>{playerName} hasn't linked yet</div></div>;
  return (
    <div style={s.mmrCard}>
      <div style={s.mmrCardHeader}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:99, background:accent, boxShadow:`0 0 8px ${accent}99` }} />
          <span style={{ fontWeight:700, fontSize:14 }}>{playerName}</span>
          {profile.source==="admin"&&verifiedBadge&&<span style={s.verifiedBadge}>captain-verified</span>}
        </div>
        {onResync&&<button onClick={onResync} className="bb-pressable" style={s.resyncBtn} disabled={resyncing}>{resyncing?"…":"resync"}</button>}
      </div>
      <div style={s.mmrGrid}>
        {profile.ranks.map((r) => (
          <div key={r.playlist} style={s.mmrItem}>
            <div style={s.mmrPlaylist}>{r.playlist.replace("Ranked ","")}</div>
            <div style={{ ...s.mmrRank, color:accent }}>{r.rank}</div>
            <div style={s.mmrNum}>{r.mmr} mmr</div>
          </div>
        ))}
      </div>
      <div style={s.mmrSynced}>{profile.source==="admin"?"set by captain":"synced"} · {new Date(profile.lastSynced).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</div>
    </div>
  );
}

// ===================== Reminder Banner =====================
function ReminderBanner({ incompleteDays, onJump, onDismiss }) {
  if (!incompleteDays.length) return null;
  const first = incompleteDays[0];
  return (
    <div style={s.reminderBanner}>
      <button onClick={()=>onJump(first.key)} style={s.reminderBtn} className="bb-pressable">
        <Bell size={15} color="#FF5C8A"/>
        <div style={{ flex:1, textAlign:"left" }}>
          <div style={s.reminderTitle}>{incompleteDays.length===1?"you have an unfinished session":`${incompleteDays.length} unfinished sessions`}</div>
          <div style={s.reminderSub}>tap to finish {fmtDay(first.date)}{first.training?` — ${first.training.title}`:""}</div>
        </div>
        <ChevronRight size={15} color="#8B92A8"/>
      </button>
    <button onClick={onDismiss} style={s.reminderClose} className="bb-pressable"><X size={13}/></button>
    </div>
  );
}
const CHALLENGE_FIELDS = ["goals","assists","saves","demos","shots"];

const ALL_CHALLENGES = [
  // 3v3
  { mode:"3v3", type:"avg", field:"goals",   target:2.5, desc:(t,r)=>`average ${t} goals/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"assists",  target:2.0, desc:(t,r)=>`average ${t} assists/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"saves",    target:3.0, desc:(t,r)=>`average ${t} saves/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"demos",    target:2.0, desc:(t,r)=>`average ${t} demos/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"shots",    target:3.5, desc:(t,r)=>`average ${t} shots/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  // 2v2
  { mode:"2v2", type:"cumulative", field:"assists", target:10, desc:(t)=>`get ${t} total assists across your 2v2 games this week`, color:"#FF61C1" },
  { mode:"2v2", type:"cumulative", field:"saves",   target:15, desc:(t)=>`rack up ${t} saves in 2v2 this week`, color:"#FF61C1" },
  { mode:"2v2", type:"avg",        field:"goals",   target:2.0, desc:(t)=>`average ${t}+ goals per game in 2v2 this week`, color:"#FF61C1" },
  { mode:"2v2", type:"winrate",    field:null,      target:0.6, desc:()=>`win more than 60% of your 2v2 games this week`, color:"#FF61C1" },
  { mode:"2v2", type:"cumulative", field:"demos",   target:8,  desc:(t)=>`land ${t} demos in 2v2 this week`, color:"#FF61C1" },
  // 1v1
  { mode:"1v1", type:"streak",     field:null,      target:3,  desc:()=>`win 3 in a row in 1v1`, color:"#4D9EFF" },
  { mode:"1v1", type:"avg",        field:"goals",   target:3.0, desc:(t)=>`average ${t}+ goals per game in 1v1 this week`, color:"#4D9EFF" },
  { mode:"1v1", type:"cumulative", field:"shots",   target:20, desc:(t)=>`take ${t} total shots in 1v1 this week`, color:"#4D9EFF" },
  { mode:"1v1", type:"avg",        field:"saves",   target:2.0, desc:(t)=>`average ${t}+ saves per game in 1v1`, color:"#4D9EFF" },
  { mode:"1v1", type:"streak",     field:null,      target:3,  desc:()=>`score first in 3 consecutive 1v1 games`, color:"#4D9EFF" },
];
function getWeekStart() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getChallengeProgress(challenge, stats, playerId) {
  const weekStart = getWeekStart();
  const games = stats.filter(g =>
    g.playerId === playerId &&
    g.mode === challenge.mode &&
    new Date(g.ts) >= weekStart
  );

  if (challenge.type === "avg") {
    const val = games.length ? games.reduce((s,g) => s+(g[challenge.field]||0),0)/games.length : 0;
    return { current: val, target: challenge.target, done: val >= challenge.target, display: val.toFixed(1) };
  }
  if (challenge.type === "cumulative") {
    const val = games.reduce((s,g) => s+(g[challenge.field]||0),0);
    return { current: val, target: challenge.target, done: val >= challenge.target, display: val };
  }
  if (challenge.type === "winrate") {
    const wins = games.filter(g => g.ourScore > g.theirScore).length;
    const rate = games.length ? wins/games.length : 0;
    return { current: rate, target: challenge.target, done: rate >= challenge.target, display: `${Math.round(rate*100)}%` };
  }
  if (challenge.type === "streak") {
    const sorted = [...games].sort((a,b) => new Date(a.ts)-new Date(b.ts));
    let streak = 0;
    for (let i = sorted.length-1; i >= 0; i--) {
      if (sorted[i].ourScore > sorted[i].theirScore) streak++;
      else break;
    }
    return { current: streak, target: challenge.target, done: streak >= challenge.target, display: streak };
  }
  return { current: 0, target: challenge.target, done: false, display: 0 };
}

function StatChallenges({ stats, currentPlayer, passXP, setPassXP, completions, setCompletions }) {
  const playerIdx = PLAYERS.findIndex(p => p.id === currentPlayer);
  const weekNum = Math.floor(Date.now() / (WEEK_MS));
  
  // Pick a deterministic but varied challenge per player per week
  const seed = weekNum * 31 + playerIdx * 7;
  const challengeIdx = seed % ALL_CHALLENGES.length;
  const challenge = ALL_CHALLENGES[challengeIdx];

  // For 3v3 avg challenges find a rival
  const rivals = PLAYERS.filter(p => p.id !== currentPlayer);
  const rival = rivals[seed % rivals.length];
  const rivalGames = stats.filter(g => g.playerId === rival.id && g.mode === "3v3");
  const rivalAvg = challenge.field && rivalGames.length
    ? (rivalGames.reduce((s,g) => s+(g[challenge.field]||0),0)/rivalGames.length).toFixed(1)
    : null;

  const adjustedTarget = challenge.type === "avg" && rivalAvg
    ? Math.max(Number(rivalAvg)+0.1, challenge.target)
    : challenge.target;

  const progress = getChallengeProgress({...challenge, target: adjustedTarget}, stats, currentPlayer);
  const claimKey = `challenge_${currentPlayer}_${weekNum}_${challengeIdx}`;
  const claimed = !!completions[claimKey];

  const claimXP = async () => {
    if (!progress.done || claimed) return;
    const upd = {...completions, [claimKey]: true};
    setCompletions(upd);
    await storeSet("completions", upd);
    const pxp = await storeGet("pass_xp") || {};
    const updXP = {...pxp, [currentPlayer]: (pxp[currentPlayer]||0)+50};
    setPassXP(updXP);
    await storeSet("pass_xp", updXP);
  };

  const modeLabel = { "3v3":"3V3","2v2":"2V2","1v1":"1V1" }[challenge.mode];
  const color = challenge.color;
  const progressPct = Math.min(1, progress.current / adjustedTarget);

  const descText = challenge.mode === "3v3" && rivalAvg
    ? challenge.desc(adjustedTarget.toFixed(1), rival.name)
    : challenge.desc(adjustedTarget);

  return (
    <div style={{marginBottom:20}}>
      <div style={{...s.sectionLabel,marginBottom:10}}>weekly challenge</div>
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:16,padding:"14px 16px",border:`1px solid ${color}22`,marginBottom:8}}>
        
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <div style={{fontSize:10,color:color,fontWeight:700,letterSpacing:0.8}}>
            {modeLabel} CHALLENGE
          </div>
          <div style={{width:6,height:6,borderRadius:99,background:color}}/>
        </div>

        <div style={{fontSize:13.5,color:"#E8ECF4",lineHeight:1.5,marginBottom:12}}>{descText}</div>

        <div style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#8B92A8",marginBottom:6}}>
            <span>progress: <span style={{color,fontWeight:700}}>{progress.display}</span></span>
            <span>target: <span style={{color:"#E8ECF4",fontWeight:700}}>{challenge.type==="winrate"?"60%":adjustedTarget}</span></span>
          </div>
          <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${progressPct*100}%`,background:progress.done?"#7CFFB2":color,borderRadius:99,transition:"width .4s ease",boxShadow:progress.done?`0 0 8px #7CFFB299`:`0 0 8px ${color}88`}}/>
          </div>
        </div>

        {progress.done && !claimed && (
          <button onClick={claimXP} className="bb-pressable bb-glow-lime"
            style={{width:"100%",background:color,border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,color:"#06070D",cursor:"pointer",marginBottom:8}}>
            🏆 claim +50 pass xp
          </button>
        )}
        {claimed && (
          <div style={{fontSize:12,color:"#7CFFB2",fontWeight:700,marginBottom:8}}>✓ +50 xp claimed this week</div>
        )}

        <div style={{fontSize:11,color:"#4A5066"}}>resets weekly · logs from {challenge.mode} games only</div>
      </div>

      {/* Mini leaderboard — only for 3v3 avg challenges */}
      {challenge.mode === "3v3" && challenge.type === "avg" && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}>
          <div style={{display:"grid",gridTemplateColumns:`60px repeat(5,1fr)`,gap:4,marginBottom:8}}>
            <div/>
            {CHALLENGE_FIELDS.map(f=><div key={f} style={{fontSize:9,color:"#4A5066",fontWeight:700,textAlign:"center",textTransform:"uppercase",letterSpacing:0.5}}>{f}</div>)}
          </div>
          {PLAYERS.map(p=>{
            const pg = stats.filter(g => g.playerId===p.id && g.mode==="3v3");
            const avg = (field) => pg.length ? (pg.reduce((s,g)=>s+(g[field]||0),0)/pg.length).toFixed(1) : "—";
            return (
              <div key={p.id} style={{display:"grid",gridTemplateColumns:`60px repeat(5,1fr)`,gap:4,marginBottom:6,alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:6,height:6,borderRadius:99,background:p.color,flexShrink:0}}/>
                  <span style={{fontSize:10,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:p.id===currentPlayer?p.color:"#E8ECF4"}}>{p.name}</span>
                </div>
                {CHALLENGE_FIELDS.map(f=>(
                  <div key={f} style={{fontSize:12,fontWeight:700,color:p.color,textAlign:"center"}}>{avg(f)}</div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
            // ===================== Coach Note =====================
function getCoachNote(stats, playerId) {
  const yesterday = new Date(todayAtMidnight().getTime() - DAY_MS);
  const ydKey = dateKey(yesterday);
  const lastNightGames = stats.filter(g =>
    g.playerId === playerId &&
    g.mode === "3v3" &&
    dateKey(new Date(g.ts)) === ydKey
  );
  if (!lastNightGames.length) return null;

  const avg = (field) => lastNightGames.reduce((s, g) => s + (g[field] || 0), 0) / lastNightGames.length;
  const wins = lastNightGames.filter(g => g.ourScore > g.theirScore).length;
  const losses = lastNightGames.length - wins;
  const avgGoals = avg("goals");
  const avgAssists = avg("assists");
  const avgSaves = avg("saves");
  const avgDemos = avg("demos");
  const avgShots = avg("shots");
  const avgScore = avg("score");

  let note = null;

  if (wins >= 3 && losses === 0) {
    note = { text: "you were locked in last night — keep that same energy, don't change anything.", emoji: "🔥" };
  } else if (losses > wins) {
    if (avgScore > 400) {
      note = { text: "your numbers were good last night but the W's weren't there — focus on team plays today.", emoji: "🤝" };
    } else {
      note = { text: "rough night last night — reset and focus on one thing today, don't try to do everything at once.", emoji: "🧘" };
    }
  } else if (avgAssists > avgGoals && avgAssists > 1.5) {
    note = { text: "you set up a lot last night — try being more selfish today, take the shots yourself.", emoji: "🎯" };
  } else if (avgGoals > 2) {
    note = { text: "you were on fire last night — try carrying that aggression into solo queue today.", emoji: "⚡" };
  } else if (avgSaves > 3) {
    note = { text: "you were doing a lot of defending last night — work on rotating faster so you're not always last back.", emoji: "🔄" };
  } else if (avgDemos > 2) {
    note = { text: "you were playing aggressively last night — channel that into positioning today instead.", emoji: "📍" };
  } else if (avgShots < 1) {
    note = { text: "you weren't shooting much last night — challenge yourself to take at least 2 shots per game today.", emoji: "🏹" };
  } else {
    note = { text: "solid session last night — keep building on it today.", emoji: "📈" };
  }

  return { ...note, date: ydKey, games: lastNightGames };
}

function CoachNoteCard({ stats, currentPlayer, onJumpToLog }) {
  const note = getCoachNote(stats, currentPlayer);
  if (!note) return null;
  const playerColor = PLAYERS.find(p => p.id === currentPlayer)?.color || "#B8FF4D";

  return (
    <button onClick={() => onJumpToLog(note.date)} className="bb-pressable" style={{ width: "100%", background: "linear-gradient(135deg,#0E1020,#0A0C1A)", border: `1px solid ${playerColor}22`, borderRadius: 16, padding: "14px 16px", marginBottom: 16, textAlign: "left", cursor: "pointer" }}>
      <div style={{ fontSize: 10, color: playerColor, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>COACH NOTE · {new Date(note.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{note.emoji}</span>
        <div>
          <div style={{ fontSize: 13.5, color: "#E8ECF4", lineHeight: 1.5 }}>{note.text}</div>
          <div style={{ fontSize: 11, color: "#4A5066", marginTop: 6 }}>{note.games.length} games logged · tap to view</div>
        </div>
      </div>
    </button>
  );
}
            // ===================== Heat Streak =====================
function getNightStreaks(stats) {
  const wins = stats
    .filter(g => g.mode === "3v3" && g.ourScore > g.theirScore)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const byDay = {};
  wins.forEach(g => {
    const dk = dateKey(new Date(g.ts));
    if (!byDay[dk]) byDay[dk] = [];
    byDay[dk].push(g);
  });

  const streaks = [];
  Object.entries(byDay).forEach(([dk, games]) => {
    const allGames = stats
      .filter(g => g.mode === "3v3" && dateKey(new Date(g.ts)) === dk)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    const uniqueTimes = [...new Set(allGames.map(g => g.ts))].sort();
    let consecutive = 0;
    let streakGames = [];

    uniqueTimes.forEach(ts => {
      const gamesAtTime = allGames.filter(g => g.ts === ts);
      const isWin = gamesAtTime.some(g => g.ourScore > g.theirScore);
      if (isWin) {
        consecutive++;
        streakGames.push({ ts, games: gamesAtTime });
      } else {
        if (consecutive >= 3) {
          streaks.push({ dk, games: streakGames, peak: consecutive });
        }
        consecutive = 0;
        streakGames = [];
      }
    });
    if (consecutive >= 3) {
      streaks.push({ dk, games: streakGames, peak: consecutive });
    }
  });

  return streaks.sort((a, b) => new Date(b.dk) - new Date(a.dk));
}

function heatMultiplier(wins) {
  if (wins >= 6) return 10;
  if (wins >= 5) return 7;
  if (wins >= 4) return 4;
  if (wins >= 3) return 2;
  return 1;
}

function HeatStreakCard({ stats, currentPlayer }) {
  const todayDk = dateKey(todayAtMidnight());
  const allStreaks = getNightStreaks(stats);
  const todayStreak = allStreaks.find(s => s.dk === todayDk);
  const history = allStreaks.filter(s => s.dk !== todayDk);
  const [expanded, setExpanded] = useState(null);

  const mult = todayStreak ? heatMultiplier(todayStreak.peak) : 1;
  const flames = ["🔥","🔥🔥","🔥🔥🔥","🔥🔥🔥🔥"];
  const flameIdx = Math.min(3, Math.max(0, todayStreak ? todayStreak.peak - 3 : 0));

  return (
    <div style={{ marginBottom: 20 }}>
      {todayStreak && (
        <div style={{ background: "linear-gradient(135deg,#1A0A00,#2A1000)", border: "1px solid rgba(255,140,50,0.4)", borderRadius: 18, padding: "16px", marginBottom: 14, boxShadow: "0 0 24px rgba(255,140,50,0.15)" }}>
          <div style={{ fontSize: 11, color: "#FF8C32", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>HEAT STREAK — TONIGHT {flames[flameIdx]}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 32, fontWeight: 700, color: "#FF8C32" }}>{todayStreak.peak}<span style={{ fontSize: 14, color: "#8B92A8", marginLeft: 6 }}>wins</span></div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 24, fontWeight: 700, color: "#FFD166" }}>{mult}x</div>
              <div style={{ fontSize: 10, color: "#8B92A8" }}>pass xp bonus</div>
            </div>
          </div>
          {todayStreak.games.map((slot, i) => {
            const rep = slot.games[0];
            const won = rep.ourScore > rep.theirScore;
            return (
              <div key={i} style={{ background: "rgba(255,140,50,0.06)", borderRadius: 11, padding: "10px 12px", marginBottom: 6, border: "1px solid rgba(255,140,50,0.15)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 16, fontWeight: 700 }}>{rep.ourScore}–{rep.theirScore}</div>
                  <div style={{ fontSize: 10, color: won ? "#7CFFB2" : "#FF5C8A", fontWeight: 700 }}>W · game {i + 1}</div>
                </div>
                {PLAYERS.map(p => {
                  const pg = slot.games.find(g => g.playerId === p.id);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 99, background: pg ? p.color : "#2E3346", flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: pg ? p.color : "#4A5066", width: 70 }}>{p.name}</span>
                      {pg ? (
                        <span style={{ fontSize: 11, color: "#8B92A8" }}>{pg.goals}g {pg.assists}a {pg.saves}sv {pg.demos}dm</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#4A5066", fontStyle: "italic" }}>didn't log</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#4A5066", fontWeight: 700, marginBottom: 10 }}>PAST HEAT STREAKS</div>
          {history.map((streak, si) => {
            const isOpen = expanded === si;
            const m = heatMultiplier(streak.peak);
            return (
              <div key={si} style={{ background: "#11131F", borderRadius: 14, marginBottom: 8, border: "1px solid rgba(255,140,50,0.15)", overflow: "hidden" }}>
                <button onClick={() => setExpanded(isOpen ? null : si)} className="bb-pressable" style={{ width: "100%", background: "none", border: "none", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#FF8C32" }}>{new Date(streak.dk + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} 🔥</div>
                    <div style={{ fontSize: 11, color: "#8B92A8", marginTop: 2 }}>{streak.peak} win streak · peak {m}x xp</div>
                  </div>
                  <ChevronRight size={15} color="#4A5066" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                </button>
                {isOpen && (
                  <div style={{ padding: "0 14px 14px" }}>
                    {streak.games.map((slot, i) => {
                      const rep = slot.games[0];
                      return (
                        <div key={i} style={{ background: "rgba(255,140,50,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 6, border: "1px solid rgba(255,140,50,0.1)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 15, fontWeight: 700 }}>{rep.ourScore}–{rep.theirScore}</div>
                            <div style={{ fontSize: 10, color: "#7CFFB2", fontWeight: 700 }}>W · game {i + 1} · {heatMultiplier(i + 3)}x</div>
                          </div>
                          {PLAYERS.map(p => {
                            const pg = slot.games.find(g => g.playerId === p.id);
                            return (
                              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 99, background: pg ? p.color : "#2E3346", flexShrink: 0 }} />
                                <span style={{ fontSize: 11, fontWeight: 700, color: pg ? p.color : "#4A5066", width: 70 }}>{p.name}</span>
                                {pg ? (
                                  <span style={{ fontSize: 11, color: "#8B92A8" }}>{pg.goals}g {pg.assists}a {pg.saves}sv {pg.demos}dm</span>
                                ) : (
                                  <span style={{ fontSize: 11, color: "#4A5066", fontStyle: "italic" }}>didn't log</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
            
// ===================== Home Tab =====================
function HomeTab({ schedule, mmrProfiles, currentPlayer, onResync, resyncingId, trainingData, completions, onGotoTraining, stats, setCompletions, onGotoStats, statsJumpDate, setStatsJumpDate, passXP, setPassXP }) {
  const allMatches = [...schedule.league, ...schedule.playoffs];
  const now = new Date();
  const nextMatch = allMatches.find((m)=>!m.result);
  const record = schedule.league.reduce((acc,m)=>{
    if (!m.result) return acc;
    if (m.result.status==="win"||m.result.status==="forfeit_win"||m.result.status==="bye") acc.w++; else acc.l++;
    acc.gf += m.result.ours||0; acc.ga += m.result.theirs||0;
    return acc;
  },{ w:0, l:0, gf:0, ga:0 });
  const daysUntil = nextMatch ? Math.max(0, Math.ceil((new Date(nextMatch.start)-now)/DAY_MS)) : null;
  const today = todayAtMidnight();
  const previewDays = Array.from({length:5},(_,i)=>{ const date=new Date(today.getTime()+i*DAY_MS); const key=dateKey(date); return {key,date,training:trainingData[tKey(key,currentPlayer)]||null}; });

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={s.heroCard}>
        <div style={s.heroEyebrow}>{nextMatch?(nextMatch.type==="playoff"?"next — playoffs":"next matchup"):"season complete"}</div>
        {nextMatch ? (
          <>
            <div style={s.heroMatchup}>
              <div style={s.heroTeam}><div style={s.heroTeamName}>burton<br/>battlers</div></div>
              <div style={s.heroVs}><div style={s.heroBo}>bo{nextMatch.bestOf}</div>vs</div>
              <div style={s.heroTeam}><div style={{...s.heroTeamName,color:nextMatch.opponent?"#E8ECF4":"#4A5066"}}>{nextMatch.opponent||"tbd"}</div></div>
            </div>
            <div style={s.heroMeta}>{nextMatch.label} · {daysUntil===0?"this week":`in ${daysUntil}d`} · {nextMatch.dateRange}</div>
          </>
        ) : <div style={s.heroMatchup}><div style={s.heroTeamName}>gg. see you next circuit.</div></div>}
      </div>

      <div style={s.recordRow}>
        <div style={s.recordBox}><div style={s.recordNum}>{record.w}-{record.l}</div><div style={s.recordLabel}>series record</div></div>
        <div style={s.recordBox}><div style={s.recordNum}>{record.gf-record.ga>=0?"+":""}{record.gf-record.ga}</div><div style={s.recordLabel}>goal diff</div></div>
        <div style={s.recordBox}><div style={s.recordNum}>{record.gf}</div><div style={s.recordLabel}>goals for</div></div>
      </div>
<CoachNoteCard stats={stats} currentPlayer={currentPlayer} onJumpToLog={(date) => { setStatsJumpDate(date); onGotoStats(); }}/>
<HeatStreakCard stats={stats} currentPlayer={currentPlayer} />
<StatChallenges stats={stats} currentPlayer={currentPlayer} completions={completions} setCompletions={setCompletions} passXP={passXP} setPassXP={setPassXP}/>
      <div style={s.sectionRowHeader}>
        <div style={s.sectionLabel}>next 5 days · your training</div>
        <button onClick={onGotoTraining} className="bb-pressable" style={s.viewAllBtn}>view all <ChevronRight size={12}/></button>
      </div>
      <div style={s.dashTrainingScroll}>
        {previewDays.map((day)=>{
          const isToday = day.key===dateKey(today);
          const isFutureLocked = currentPlayer!==ADMIN_ID && day.date>today;
          const comp = completions[tKey(day.key,currentPlayer)];
          return (
            <div key={day.key} onClick={onGotoTraining} className="bb-pressable bb-glow-violet"
              style={{...s.dashTrainingCard,borderColor:isToday?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.07)"}}>
              <div style={s.dashTrainingDay}>{isToday?"today":fmtDayShort(day.date)}</div>
              {day.training ? isFutureLocked
                ? <><div style={{...s.dashTrainingTitle,...s.blurredText}}>{day.training.title}</div><div style={s.dashLockedTag}><Lock size={9}/> locked</div></>
                : <><div style={s.dashTrainingTitle}>{day.training.title}</div>
                    {comp?.status==="approved"?<div style={s.dashDoneTag}><Check size={10}/> approved</div>
                      :comp?.status==="pending"?<div style={s.dashPendingTag}>pending</div>
                      :comp?.status==="rejected"?<div style={s.dashRejectedTag}>redo</div>
                      :<div style={s.dashOpenTag}>open</div>}</>
                : <div style={s.dashTrainingEmpty}>not assigned</div>}
            </div>
          );
        })}
      </div>

      <div style={{...s.sectionLabel,marginTop:22}}>team mmr</div>
      {PLAYERS.map((p)=>(
        <MMRCard key={p.id} profile={mmrProfiles[p.id]} playerName={p.name} accent={p.color} onResync={()=>onResync(p.id)} resyncing={resyncingId===p.id} verifiedBadge/>
      ))}
    </div>
  );
}

// ===================== Bracket Tab =====================
function MatchRow({ m, onEdit, editable }) {
  const ok = m.result?.status.includes("win")||m.result?.status==="bye";
  const statusColor = !m.result?"#4A5066":ok?"#7CFFB2":"#FF5C8A";
  const statusText = !m.result?"upcoming":m.result.status==="win"?"win":m.result.status==="loss"?"loss":m.result.status==="forfeit_win"?"forfeit w":m.result.status==="forfeit_loss"?"forfeit l":"bye";
  return (
    <button onClick={()=>editable&&onEdit(m)} className="bb-pressable bb-glow-lime" style={s.matchRow}>
      <div>
        <div style={s.matchRowWeek}>{m.label}</div>
        <div style={s.matchRowOpp}>{m.opponent||"opponent tbd"}</div>
        <div style={s.matchRowDate}>{m.dateRange}</div>
      </div>
      <div style={s.matchRowRight}>
        {m.result?.ours!==undefined&&<div style={s.matchRowScore}>{m.result.ours}–{m.result.theirs}</div>}
        <div style={{...s.matchRowStatus,color:statusColor,borderColor:statusColor}}>{statusText}</div>
      </div>
    </button>
  );
}
function MatchEditor({ match, onSave, onClose }) {
  const [opponent,setOpponent]=useState(match.opponent||"");
  const [ours,setOurs]=useState(match.result?.ours??"");
  const [theirs,setTheirs]=useState(match.result?.theirs??"");
  const [status,setStatus]=useState(match.result?.status||"");
  const save=()=>{ const result=status===""?null:{status,ours:ours===""?0:Number(ours),theirs:theirs===""?0:Number(theirs)}; onSave({...match,opponent:opponent.trim(),result}); onClose(); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={s.modalBox} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>{match.label}</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={s.modalLabel}>opponent</div><input value={opponent} onChange={(e)=>setOpponent(e.target.value)} placeholder="team name" style={s.modalInput}/>
      <div style={s.modalLabel}>result</div>
      <div style={s.modalStatusGrid}>
        {["win","loss","forfeit_win","forfeit_loss","bye",""].map((st)=>(
          <button key={st||"none"} onClick={()=>setStatus(st)} className="bb-pressable"
            style={{...s.modalStatusBtn,background:status===st?"#B8FF4D":"rgba(255,255,255,0.05)",color:status===st?"#06070D":"#8B92A8"}}>
            {st===""?"not played":st.replace("_"," ")}
          </button>
        ))}
      </div>
      {status&&status!=="bye"&&(
        <div style={s.modalScoreRow}>
          <div style={{flex:1}}><div style={s.modalLabel}>games won (us)</div><input type="number" value={ours} onChange={(e)=>setOurs(e.target.value)} style={s.modalInput}/></div>
          <div style={{flex:1}}><div style={s.modalLabel}>games won (them)</div><input type="number" value={theirs} onChange={(e)=>setTheirs(e.target.value)} style={s.modalInput}/></div>
        </div>
      )}
      <button onClick={save} className="bb-pressable bb-glow-lime" style={s.primaryBtn}>save</button>
    </div></div>
  );
}
function BracketTab({ schedule, setSchedule, currentPlayer }) {
  const [editing,setEditing]=useState(null);
  const isCaptain=currentPlayer===ADMIN_ID;
  const saveMatch=async(updated)=>{
    const isPlayoff=updated.id.startsWith("po");
    const key=isPlayoff?"playoffs":"league";
    const next={...schedule,[key]:schedule[key].map((m)=>m.id===updated.id?updated:m)};
    setSchedule(next);
    await storeSet("schedule",next);
  };
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {editing&&<MatchEditor match={editing} onSave={saveMatch} onClose={()=>setEditing(null)}/>}
      <div style={s.sectionLabel}>league play · swiss format</div>
      <div style={s.sectionSubLabel}>jul 20 – aug 23 · best-of-5 · 1 match/week</div>
      {schedule.league.map((m)=><MatchRow key={m.id} m={m} onEdit={setEditing} editable={isCaptain}/>)}
      <div style={{...s.sectionLabel,marginTop:24}}>playoffs · single elim</div>
      <div style={s.sectionSubLabel}>aug 24 – sep 21 · best-of-7 · top 16 advance</div>
      {schedule.playoffs.map((m)=><MatchRow key={m.id} m={m} onEdit={setEditing} editable={isCaptain}/>)}
      {!isCaptain&&<div style={s.hintText}>only the captain can edit matchups & results.</div>}
    </div>
  );
}

// ===================== Training Tab =====================
function StatusPill({ status }) {
  if (status==="approved") return <div style={s.allDoneBadge}><Check size={12}/> approved</div>;
  if (status==="pending")  return <div style={s.pendingBadge}><Clock size={12}/> pending review</div>;
  if (status==="rejected") return <div style={s.rejectedBadge}><X size={12}/> needs redo</div>;
  return null;
}
function TrainingDayCard({ day, isToday, isFutureLocked, completion, onSubmitNumeric, onSubmitText, onOpenComments }) {
  const training = day.training;
  const isNumeric = training?.targetAmount!=null&&training?.targetAmount!=="";
  const [count,setCount]=useState(completion?.amount??0);
  useEffect(()=>{ setCount(completion?.amount??0); },[completion?.amount,day.key]);
  const submitLocked = completion?.status==="pending"||completion?.status==="approved";

  if (isFutureLocked&&training) return (
    <div style={s.trainingCard}>
      <div style={s.trainingCardHeader}><div><div style={s.trainingDate}>{fmtDay(day.date)}</div></div><Lock size={15} color="#4A5066"/></div>
      <div style={{...s.trainingTitle,...s.blurredText}}>{training.title}</div>
      <div style={{...s.trainingDesc,...s.blurredText}}>{training.description||"session details locked"}</div>
      <div style={s.lockedFooter}>unlocks {fmtDay(day.date)}</div>
    </div>
  );

  return (
    <div style={s.trainingCard}>
      <div style={s.trainingCardHeader}>
        <div><div style={s.trainingDate}>{fmtDay(day.date)}</div>{isToday&&<div style={s.todayBadge}>today</div>}</div>
        {completion&&<StatusPill status={completion.status}/>}
      </div>
      {!training ? <div style={s.lockedText}>no training assigned</div> : (
        <>
          <div style={s.trainingTitle}>{training.title}</div>
          <div style={s.trainingDesc}>{training.description}</div>
          {training.packCode&&<div style={s.packCode}>pack code: <span style={{color:"#B8FF4D"}}>{training.packCode}</span></div>}
          {completion?.status==="rejected"&&completion.note&&(
            <div style={s.rejectNote}><span style={{color:"#FF5C8A",fontWeight:700}}>captain note:</span> {completion.note}</div>
          )}
          {isNumeric ? (
            <div style={s.numericWrap}>
              <div style={s.numericLabel}>target: {training.targetAmount} {training.unit||"reps"}</div>
              <div style={s.numericCounter}>
                <button disabled={submitLocked} onClick={()=>setCount((c)=>Math.max(0,c-1))} className="bb-pressable" style={{...s.counterBtn,opacity:submitLocked?0.4:1}}><Minus size={16}/></button>
                <div style={s.counterVal}>{count}</div>
                <button disabled={submitLocked} onClick={()=>setCount((c)=>c+1)} className="bb-pressable" style={{...s.counterBtn,opacity:submitLocked?0.4:1}}><Plus size={16}/></button>
              </div>
              <button disabled={submitLocked} onClick={()=>onSubmitNumeric(day.key,count)} className="bb-pressable"
                style={{...s.completeBtn,background:submitLocked?"rgba(255,255,255,0.04)":"#B8FF4D",color:submitLocked?"#7CFFB2":"#06070D",cursor:submitLocked?"default":"pointer",marginTop:10}}>
                {completion?.status==="approved"?<><Check size={15}/> approved</>:completion?.status==="pending"?"submitted — awaiting review":completion?.status==="rejected"?"resubmit":"submit for review"}
              </button>
              <div style={{marginTop:8,display:"flex",justifyContent:"flex-end"}}><button onClick={()=>onOpenComments(day.key)} className="bb-pressable" style={s.commentBtn}><MessageCircle size={15}/></button></div>
            </div>
          ) : (
            <div style={s.trainingActions}>
              <button disabled={submitLocked} onClick={()=>onSubmitText(day.key)} className="bb-pressable"
                style={{...s.completeBtn,background:submitLocked?"rgba(255,255,255,0.04)":"#B8FF4D",color:submitLocked?"#7CFFB2":"#06070D",cursor:submitLocked?"default":"pointer"}}>
                {completion?.status==="approved"?<><Check size={15}/> approved</>:completion?.status==="pending"?"submitted — awaiting review":completion?.status==="rejected"?"resubmit":"mark complete"}
              </button>
              <button onClick={()=>onOpenComments(day.key)} className="bb-pressable" style={s.commentBtn}><MessageCircle size={15}/></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function TrainingTab({ trainingData, completions, setCompletions, currentPlayer, onOpenComments, jumpKey, onJumpHandled }) {
  const today=todayAtMidnight();
  const totalDays=Math.ceil((PLAYOFF_END-TRAINING_START)/DAY_MS);
  const startIdx=Math.max(0,Math.floor((today-TRAINING_START)/DAY_MS)-5);
  const days=Array.from({length:Math.min(totalDays-startIdx,16)},(_,i)=>{ const date=new Date(TRAINING_START.getTime()+(startIdx+i)*DAY_MS); const key=dateKey(date); return {key,date,training:trainingData[tKey(key,currentPlayer)]||null}; });

  useEffect(()=>{ if(jumpKey){ document.getElementById(`train-${jumpKey}`)?.scrollIntoView({behavior:"smooth",block:"center"}); onJumpHandled(); } },[jumpKey]);

  const submitText=async(key)=>{ const ck=tKey(key,currentPlayer); const upd={...completions,[ck]:{status:"pending",type:"text",submittedAt:new Date().toISOString()}}; setCompletions(upd); await storeSet("completions",upd); };
  const submitNumeric=async(key,amount)=>{ const ck=tKey(key,currentPlayer); const upd={...completions,[ck]:{status:"pending",type:"numeric",amount,submittedAt:new Date().toISOString()}}; setCompletions(upd); await storeSet("completions",upd); };

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={s.sectionLabel}>daily training</div>
      <div style={s.sectionSubLabel}>{currentPlayer===ADMIN_ID?"you can see every session":"submit sessions — your captain reviews each one"}</div>
      {days.map((day)=>{
        const isToday=day.key===dateKey(today);
        const isFutureLocked=currentPlayer!==ADMIN_ID&&day.date>today;
        return <div key={day.key} id={`train-${day.key}`}><TrainingDayCard day={day} isToday={isToday} isFutureLocked={isFutureLocked} completion={completions[tKey(day.key,currentPlayer)]} onSubmitText={submitText} onSubmitNumeric={submitNumeric} onOpenComments={onOpenComments}/></div>;
      })}
    </div>
  );
}

// ===================== Verification Tab =====================
function VerificationTab({ trainingData, completions, setCompletions, addToast, passXP, setPassXP }) {
  const [noteDraft,setNoteDraft]=useState({});
  const pendingByPlayer=PLAYERS.map((p)=>{
    const items=Object.entries(completions).filter(([k,v])=>k.endsWith(`__${p.id}`)&&v.status==="pending").map(([k,v])=>{ const dk=k.split("__")[0]; return {key:k,dayKey:dk,training:trainingData[tKey(dk,p.id)],completion:v}; }).sort((a,b)=>a.dayKey.localeCompare(b.dayKey));
    return {player:p,items};
  }).filter((g)=>g.items.length>0);
  const totalPending=pendingByPlayer.reduce((a,g)=>a+g.items.length,0);
  const decide=async(key,decision)=>{
    const note=noteDraft[key]||"";
    const upd={...completions,[key]:{...completions[key],status:decision,note:decision==="rejected"?note:undefined,reviewedAt:new Date().toISOString()}};
    setCompletions(upd); await storeSet("completions",upd);
   addToast?.(decision==="approved"?"training approved — +15 pts":`needs redo: ${note||"check the app"}`, decision==="approved"?"✅":"❌");
    if (decision==="approved") {
      const pts=await storeGet("points")||{};
      const pid=key.split("__")[1];
      await storeSet("points",{...pts,[pid]:(pts[pid]||0)+15});
    }
      if (decision==="approved") {
      const pts=await storeGet("points")||{};
      const pid=key.split("__")[1];
      await storeSet("points",{...pts,[pid]:(pts[pid]||0)+15});
   const pxp=await storeGet("pass_xp")||{};
      const activeBoosts=await storeGet("pass_active_boosts")||{};
      const mult=getActiveBoostMultiplier(pid,activeBoosts);
      const updXP={...pxp,[pid]:(pxp[pid]||0)+20*mult};
      setPassXP(updXP); await storeSet("pass_xp",updXP);
    }
    setNoteDraft((d)=>{ const n={...d}; delete n[key]; return n; });
  };
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={s.adminHeader}><ClipboardCheck size={16} color="#FF5C8A"/><span style={s.adminHeaderText}>verification queue</span></div>
      <div style={s.sectionSubLabel}>{totalPending===0?"nothing waiting":`${totalPending} submission(s) waiting for review`}</div>
      {pendingByPlayer.length===0&&<div style={s.emptyQueue}>all caught up. submissions will show up here.</div>}
      {pendingByPlayer.map((group)=>(
        <div key={group.player.id} style={{marginBottom:22}}>
          <div style={s.verifyPlayerHeader}>
            <div style={{width:8,height:8,borderRadius:99,background:group.player.color}}/>
            <span style={{fontWeight:700,fontSize:14}}>{group.player.name}</span>
            <span style={s.verifyCount}>{group.items.length} pending</span>
          </div>
          {group.items.map((item)=>(
            <div key={item.key} style={s.verifyCard}>
              <div style={s.verifyCardTop}><div style={s.verifyDate}>{fmtDay(new Date(item.dayKey+"T00:00:00"))}</div><div style={s.verifySubmittedAt}>{fmtRelTime(item.completion.submittedAt)}</div></div>
              <div style={s.verifyTitle}>{item.training?.title||"(deleted)"}</div>
              {item.completion.type==="numeric"&&<div style={s.verifyAmount}>logged <span style={{color:"#B8FF4D",fontWeight:700}}>{item.completion.amount}</span> / target {item.training?.targetAmount} {item.training?.unit||"reps"}</div>}
              <input value={noteDraft[item.key]||""} onChange={(e)=>setNoteDraft((d)=>({...d,[item.key]:e.target.value}))} placeholder="optional note (shown if rejected)" style={{...s.modalInput,marginTop:10,marginBottom:10}}/>
              <div style={s.verifyActionsRow}>
                <button onClick={()=>decide(item.key,"rejected")} className="bb-pressable" style={s.rejectBtn}><ThumbsDown size={14}/> needs redo</button>
                <button onClick={()=>decide(item.key,"approved")} className="bb-pressable bb-glow-lime" style={s.approveBtn}><ThumbsUp size={14}/> approve</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ===================== Streaming Tab =====================
function StreamTab({ streamProfiles, setStreamProfiles, currentPlayer }) {
  const [editingTwitch,setEditingTwitch]=useState(false);
  const [draft,setDraft]=useState(streamProfiles[currentPlayer]?.twitch||"");
  const [activeStream,setActiveStream]=useState(null);

  const saveTwitch=async()=>{
    const upd={...streamProfiles,[currentPlayer]:{...streamProfiles[currentPlayer],twitch:draft.trim()}};
    setStreamProfiles(upd);
    await storeSet("stream_profiles",upd);
    setEditingTwitch(false);
  };

  const livePlayer = activeStream && PLAYERS.find((p)=>p.id===activeStream);
  const twitchHandle = livePlayer && streamProfiles[livePlayer.id]?.twitch;

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {activeStream && twitchHandle ? (
        <>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <button onClick={()=>setActiveStream(null)} className="bb-pressable" style={{...s.backBtn,position:"static",fontSize:13}}><ChevronLeft size={15}/> back</button>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div className="bb-live-dot" style={{width:8,height:8,borderRadius:99,background:"#FF5C8A"}}/>
              <span style={{fontWeight:700,fontSize:13}}>{livePlayer.name} · live</span>
            </div>
          </div>
          <div style={s.streamEmbed}>
            <iframe
              src={`https://player.twitch.tv/?channel=${twitchHandle}&parent=${window.location.hostname}&autoplay=true&muted=false`}
              style={{width:"100%",height:"100%",border:"none",borderRadius:14}}
              allowFullScreen
            />
          </div>
          <div style={s.streamBelowEmbed}>
            <a href={`https://twitch.tv/${twitchHandle}`} target="_blank" rel="noreferrer" style={s.twitchLink}>open on twitch ↗</a>
          </div>
        </>
      ) : (
        <>
          <div style={s.sectionRowHeader}>
            <div style={s.sectionLabel}>team streams</div>
            <button onClick={()=>setEditingTwitch(true)} className="bb-pressable" style={s.newPostBtn}><Edit3 size={13}/> my twitch</button>
          </div>
          <div style={s.sectionSubLabel}>when a teammate goes live on twitch, tap to watch right here</div>

          {editingTwitch && (
            <div style={s.twitchEditCard}>
              <div style={s.modalLabel}>your twitch username</div>
              <div style={{display:"flex",gap:8,marginTop:6}}>
                <input value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="e.g. maglvxx" style={{...s.modalInput,flex:1}} autoFocus/>
                <button onClick={saveTwitch} className="bb-pressable bb-glow-lime" style={{...s.chatSendBtn,width:54,borderRadius:10}}><Check size={16}/></button>
              </div>
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:10}}>
            {PLAYERS.map((p)=>{
              const handle=streamProfiles[p.id]?.twitch;
              return (
                <div key={p.id} style={s.streamPlayerCard}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <div style={{width:10,height:10,borderRadius:99,background:p.color,boxShadow:`0 0 8px ${p.color}99`}}/>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                      {handle ? <div style={{fontSize:11.5,color:"#8B92A8",marginTop:2}}>twitch.tv/{handle}</div> : <div style={{fontSize:11.5,color:"#4A5066",marginTop:2}}>no twitch linked</div>}
                    </div>
                  </div>
                  {handle ? (
                    <button onClick={()=>setActiveStream(p.id)} className="bb-pressable bb-glow-violet" style={s.watchBtn}>
                      <Tv size={14}/> watch
                    </button>
                  ) : (
                    <div style={s.offlineChip}>offline</div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={s.streamNote}>
            <div style={{fontWeight:700,color:"#A78BFA",fontSize:12,marginBottom:4}}>how to stream from console</div>
            <div style={{fontSize:12.5,color:"#8B92A8",lineHeight:1.5}}>
              <b style={{color:"#E8ECF4"}}>PS4:</b> share button → broadcast gameplay → twitch → sign in<br/>
              <b style={{color:"#E8ECF4"}}>Xbox:</b> xbox button → capture & share → stream → twitch → sign in<br/>
              once you're live, your teammates can watch here without leaving the app.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===================== Chat Tab =====================
function ChatMessage({ msg, isMe }) {
  const player=PLAYERS.find((p)=>p.id===msg.playerId);
  return (
    <div style={{...s.chatMsgRow,justifyContent:isMe?"flex-end":"flex-start"}}>
      <div style={{...s.chatBubble,background:isMe?"#B8FF4D":"#161927",color:isMe?"#06070D":"#E8ECF4"}}>
        {!isMe&&<div style={{...s.chatAuthor,color:player?.color}}>{player?.name}</div>}
        <div style={s.chatText}>{msg.text}</div>
        <div style={{...s.chatTime,color:isMe?"rgba(6,7,13,0.5)":"#4A5066"}}>{new Date(msg.ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</div>
      </div>
    </div>
  );
}
function ChatTab({ messages, setMessages, currentPlayer, addToast }) {
  const [text,setText]=useState("");
  const scrollRef=useRef(null);
  useEffect(()=>{ scrollRef.current?.scrollIntoView({behavior:"smooth"}); },[messages.length]);
  const send=async()=>{
    if (!text.trim()) return;
    const msg={id:Date.now().toString(),playerId:currentPlayer,text:text.trim(),ts:new Date().toISOString()};
   const upd=[...messages,msg];
    setMessages(upd); await storeSet("chat",upd); setText("");
addToast?.(`${PLAYERS.find(pl=>pl.id===currentPlayer)?.name}: ${text.trim()}`, "💬");
  };
  return (
    <div className="bb-tab-content" style={s.chatTabWrap}>
      <div style={s.chatHeader}><div style={s.sectionLabel}>team chat</div><div style={s.sectionSubLabel}>talk about last night, plan the next session</div></div>
      <div style={s.chatScroll}>
        {messages.length===0&&<div style={s.chatEmpty}>no messages yet. say something to the squad.</div>}
        {messages.map((m)=><ChatMessage key={m.id} msg={m} isMe={m.playerId===currentPlayer}/>)}
        <div ref={scrollRef}/>
      </div>
      <div style={s.chatInputRow}>
        <input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&send()} placeholder="message the team..." style={s.chatInput}/>
        <button onClick={send} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}><Send size={16}/></button>
      </div>
    </div>
  );
}

// ===================== Social Tab =====================
function SocialComposer({ currentPlayer, onPost, onClose }) {
  const [caption,setCaption]=useState(""); const [file,setFile]=useState(null); const [previewUrl,setPreviewUrl]=useState(null); const [uploading,setUploading]=useState(false);
  const fileRef=useRef(null);
  const pickFile=(e)=>{ const f=e.target.files?.[0]; if(!f)return; setFile(f); setPreviewUrl(URL.createObjectURL(f)); };
  const submit=async()=>{ if(!file&&!caption.trim())return; setUploading(true); await onPost({caption:caption.trim(),file}); setUploading(false); onClose(); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={s.modalBox} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>new post</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <input ref={fileRef} type="file" accept="image/*,video/*" onChange={pickFile} style={{display:"none"}}/>
      <button onClick={()=>fileRef.current?.click()} className="bb-pressable" style={s.imagePickBtn}>
        {previewUrl
  ? file?.type?.startsWith("video/")
    ? <video src={previewUrl} style={s.imagePreview} controls muted playsInline/>
    : <img src={previewUrl} alt="preview" style={s.imagePreview}/>
 : <><ImageIcon size={22} color="#4A5066"/><span style={{color:"#4A5066",fontSize:13,marginTop:6}}>tap to add a photo or video</span></>}
      </button>
      <div style={s.modalLabel}>caption</div>
      <textarea value={caption} onChange={(e)=>setCaption(e.target.value)} placeholder="what happened..." style={{...s.modalInput,minHeight:70,resize:"vertical"}}/>
      <button onClick={submit} disabled={(!file&&!caption.trim())||uploading} className="bb-pressable bb-glow-lime" style={{...s.primaryBtn,opacity:((!file&&!caption.trim())||uploading)?0.4:1}}>
        {uploading?"uploading...":"post to team"}
      </button>
    </div></div>
  );
}
function PostCard({ post, currentPlayer, onToggleHeart, onOpenComments }) {
  const player=PLAYERS.find((p)=>p.id===post.playerId);
  const hearted=(post.hearts||[]).includes(currentPlayer);
  const [popped,setPopped]=useState(false);
  const heartClick=()=>{ setPopped(true); setTimeout(()=>setPopped(false),320); onToggleHeart(post.id); };
  return (
    <div style={s.postCard}>
      <div style={s.postHeader}>
        <div style={{width:8,height:8,borderRadius:99,background:player?.color,boxShadow:`0 0 8px ${player?.color}99`}}/>
        <span style={{fontWeight:700,fontSize:13.5}}>{player?.name}</span>
        <span style={s.postTime}>{fmtRelTime(post.ts)}</span>
      </div>
      {post.image&&(post.isVideo
  ? <video src={post.image} style={s.postImage} controls muted playsInline loop/>
  : <img src={post.image} alt="post" style={s.postImage}/>)}
      {post.caption&&<div style={s.postCaption}>{post.caption}</div>}
      <div style={s.postActions}>
        <button onClick={heartClick} className="bb-pressable" style={s.postActionBtn}>
          <Heart size={18} className={popped?"bb-heart-pop":""} color={hearted?"#FF5C8A":"#4A5066"} fill={hearted?"#FF5C8A":"none"}/>
          <span style={{color:hearted?"#FF5C8A":"#4A5066",fontSize:12.5,fontWeight:700}}>{(post.hearts||[]).length}</span>
        </button>
        <button onClick={()=>onOpenComments(post)} className="bb-pressable" style={s.postActionBtn}>
          <MessageCircle size={17} color="#4A5066"/>
          <span style={{color:"#4A5066",fontSize:12.5,fontWeight:700}}>{(post.comments||[]).length}</span>
        </button>
      </div>
    </div>
  );
}
function PostCommentsModal({ post, onAddComment, currentPlayer, onClose }) {
  const [text,setText]=useState("");
  const submit=()=>{ if(!text.trim())return; onAddComment(post.id,text.trim()); setText(""); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={{...s.modalBox,maxHeight:"75vh",display:"flex",flexDirection:"column"}} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>comments</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
        {!(post.comments||[]).length&&<div style={s.chatEmpty}>no comments yet.</div>}
        {(post.comments||[]).map((c)=>{ const p=PLAYERS.find((pl)=>pl.id===c.playerId); return <div key={c.id} style={s.commentItem}><div style={{width:6,height:6,borderRadius:99,background:p?.color,marginTop:6,flexShrink:0}}/><div><div style={{fontSize:12,fontWeight:700,color:p?.color}}>{p?.name}</div><div style={{fontSize:14,color:"#E8ECF4"}}>{c.text}</div></div></div>; })}
      </div>
      <div style={s.chatInputRow}><input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&submit()} placeholder="add a comment..." style={s.chatInput}/><button onClick={submit} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}><Send size={16}/></button></div>
    </div></div>
  );
}
function SocialTab({ posts, setPosts, currentPlayer, addToast }) {
  const [composing,setComposing]=useState(false); const [commentingOn,setCommentingOn]=useState(null);
  const addPost=async(data)=>{ let img=null; if(data.file) img=await uploadPostImage(data.file); const post={id:Date.now().toString(),playerId:currentPlayer,caption:data.caption,image:img,isVideo:data.file?.type?.startsWith("video/"),ts:new Date().toISOString(),hearts:[],comments:[]}; const upd=[post,...posts]; setPosts(upd); await storeSet("posts",upd);
addToast?.(`${PLAYERS.find(pl=>pl.id===currentPlayer)?.name} posted something`, "📸");

  };
  const toggleHeart=async(postId)=>{ const upd=posts.map((p)=>{if(p.id!==postId)return p; const hearts=p.hearts||[]; return {...p,hearts:hearts.includes(currentPlayer)?hearts.filter((id)=>id!==currentPlayer):[...hearts,currentPlayer]}; }); setPosts(upd); await storeSet("posts",upd); };
  const addComment=async(postId,text)=>{ const comment={id:Date.now().toString(),playerId:currentPlayer,text,ts:new Date().toISOString()}; const upd=posts.map((p)=>p.id===postId?{...p,comments:[...(p.comments||[]),comment]}:p); setPosts(upd); await storeSet("posts",upd); setCommentingOn((prev)=>prev?upd.find((p)=>p.id===prev.id):prev); };
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {composing&&<SocialComposer currentPlayer={currentPlayer} onPost={addPost} onClose={()=>setComposing(false)}/>}
      {commentingOn&&<PostCommentsModal post={commentingOn} onAddComment={addComment} currentPlayer={currentPlayer} onClose={()=>setCommentingOn(null)}/>}
      <div style={s.sectionRowHeader}>
        <div style={s.sectionLabel}>team feed</div>
        <button onClick={()=>setComposing(true)} className="bb-pressable bb-glow-violet" style={s.newPostBtn}><Plus size={14}/> post</button>
      </div>
      {posts.length===0&&<div style={s.emptyQueue}>no posts yet — share a clip or a funny moment.</div>}
      {posts.map((post)=><PostCard key={post.id} post={post} currentPlayer={currentPlayer} onToggleHeart={toggleHeart} onOpenComments={setCommentingOn}/>)}
    </div>
  );
}

// ===================== Training Comments Modal =====================
function CommentsModal({ dayKey, comments, setComments, currentPlayer, onClose }) {
  const [text,setText]=useState(""); const dayComments=comments[dayKey]||[];
  const send=async()=>{ if(!text.trim())return; const comment={id:Date.now().toString(),playerId:currentPlayer,text:text.trim(),ts:new Date().toISOString()}; const upd={...comments,[dayKey]:[...dayComments,comment]}; setComments(upd); await storeSet("comments",upd); setText(""); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={{...s.modalBox,maxHeight:"75vh",display:"flex",flexDirection:"column"}} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>notes & feedback</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
        {dayComments.length===0&&<div style={s.chatEmpty}>no notes yet.</div>}
        {dayComments.map((c)=>{ const p=PLAYERS.find((pl)=>pl.id===c.playerId); return <div key={c.id} style={s.commentItem}><div style={{width:6,height:6,borderRadius:99,background:p?.color,marginTop:6,flexShrink:0}}/><div><div style={{fontSize:12,fontWeight:700,color:p?.color}}>{p?.name}</div><div style={{fontSize:14,color:"#E8ECF4"}}>{c.text}</div></div></div>; })}
      </div>
      <div style={s.chatInputRow}><input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&send()} placeholder="leave a note..." style={s.chatInput}/><button onClick={send} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}><Send size={16}/></button></div>
    </div></div>
  );
}

// ===================== Admin Tab =====================
function AdminAssignTraining({ dateKeyStr, player, existing, onSave, onClose }) {
  const [title,setTitle]=useState(existing?.title||""); const [description,setDescription]=useState(existing?.description||""); const [packCode,setPackCode]=useState(existing?.packCode||""); const [isNumeric,setIsNumeric]=useState(existing?.targetAmount!=null&&existing?.targetAmount!==""); const [targetAmount,setTargetAmount]=useState(existing?.targetAmount??""); const [unit,setUnit]=useState(existing?.unit||"reps");
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={s.modalBox} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div><div style={s.modalTitle}>assign training</div><div style={{fontSize:11.5,color:"#8B92A8",marginTop:2}}>{dateKeyStr} · for <span style={{color:player.color,fontWeight:700}}>{player.name}</span></div></div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={s.modalLabel}>title</div><input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="e.g. air dribble reps" style={s.modalInput}/>
      <div style={s.modalLabel}>description</div><textarea value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="what to work on..." style={{...s.modalInput,minHeight:80,resize:"vertical"}}/>
      <div style={s.modalLabel}>training pack code (optional)</div><input value={packCode} onChange={(e)=>setPackCode(e.target.value)} placeholder="e.g. A503-26B0-..." style={s.modalInput}/>
      <button onClick={()=>setIsNumeric((v)=>!v)} className="bb-pressable" style={{...s.numericToggle,background:isNumeric?"rgba(184,255,77,0.12)":"rgba(255,255,255,0.04)",borderColor:isNumeric?"rgba(184,255,77,0.4)":"rgba(255,255,255,0.1)"}}>
        <div style={{...s.checkbox,background:isNumeric?"#B8FF4D":"transparent",borderColor:isNumeric?"#B8FF4D":"#4A5066"}}>{isNumeric&&<Check size={12} color="#06070D"/>}</div>
        this is a numeric / counted training
      </button>
      {isNumeric&&<div style={s.modalScoreRow}><div style={{flex:1}}><div style={s.modalLabel}>target amount</div><input type="number" value={targetAmount} onChange={(e)=>setTargetAmount(e.target.value)} style={s.modalInput}/></div><div style={{flex:1}}><div style={s.modalLabel}>unit</div><input value={unit} onChange={(e)=>setUnit(e.target.value)} placeholder="reps, seconds…" style={s.modalInput}/></div></div>}
      <button onClick={()=>{ onSave({title,description,packCode,targetAmount:isNumeric?targetAmount:null,unit:isNumeric?unit:null}); onClose(); }} disabled={!title.trim()} className="bb-pressable bb-glow-lime" style={{...s.primaryBtn,opacity:title.trim()?1:0.4}}>save training for {player.name}</button>
    </div></div>
  );
}
function AdminSetMMR({ player, existing, onSave, onClose }) {
  const [vals,setVals]=useState(()=>existing?.ranks?existing.ranks.reduce((acc,r)=>({...acc,[r.playlist]:r.mmr}),{}):RL_PLAYLISTS.reduce((acc,p)=>({...acc,[p]:""}),{}));
  const save=()=>{ const ranks=RL_PLAYLISTS.map((pl)=>{ const mmr=Number(vals[pl])||0; return {playlist:pl,mmr,rank:rankFromMMR(mmr)}; }); onSave({platform:existing?.platform||"manual",handle:existing?.handle||player.name,ranks,lastSynced:new Date().toISOString(),source:"admin"}); onClose(); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={s.modalBox} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>set mmr — {player.name}</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={{fontSize:12.5,color:"#8B92A8",marginBottom:8,lineHeight:1.4}}>replaces their synced mmr — shows as captain-verified.</div>
      {RL_PLAYLISTS.map((pl)=>(<div key={pl}><div style={s.modalLabel}>{pl}</div><input type="number" value={vals[pl]} onChange={(e)=>setVals((v)=>({...v,[pl]:e.target.value}))} placeholder="mmr value" style={s.modalInput}/></div>))}
      <button onClick={save} className="bb-pressable bb-glow-lime" style={s.primaryBtn}>save & send to {player.name}</button>
    </div></div>
  );
}
function AdminTab({ trainingData, setTrainingData, mmrProfiles, setMmrProfiles, addToast, completions, setCompletions, passXP, setPassXP }) {
  const [assigning,setAssigning]=useState(null); const [settingMmrFor,setSettingMmrFor]=useState(null); const [activePlayerTab,setActivePlayerTab]=useState(PLAYERS[0].id);
  const today=todayAtMidnight();
  const totalDays=Math.ceil((PLAYOFF_END-TRAINING_START)/DAY_MS);
  const startIdx=Math.max(0,Math.floor((today-TRAINING_START)/DAY_MS)-1);
  const days=Array.from({length:Math.min(totalDays-startIdx,21)},(_,i)=>{ const date=new Date(TRAINING_START.getTime()+(startIdx+i)*DAY_MS); return {key:dateKey(date),date}; });
  const saveTraining=async(dk,pid,data)=>{ const upd={...trainingData,[tKey(dk,pid)]:data}; setTrainingData(upd); await storeSet("training",upd);
addToast?.(`training assigned to ${PLAYERS.find(p=>p.id===pid)?.name}`, "🏋️");
  };
 const saveMmr=async(pid,profile)=>{ const upd={...mmrProfiles,[pid]:profile}; setMmrProfiles(upd); await setMMR(pid,profile); };
  const activePlayer=PLAYERS.find((p)=>p.id===activePlayerTab);
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {assigning&&<AdminAssignTraining dateKeyStr={assigning.dateKeyStr} player={PLAYERS.find((p)=>p.id===assigning.playerId)} existing={trainingData[tKey(assigning.dateKeyStr,assigning.playerId)]} onSave={(data)=>saveTraining(assigning.dateKeyStr,assigning.playerId,data)} onClose={()=>setAssigning(null)}/>}
      {settingMmrFor&&<AdminSetMMR player={PLAYERS.find((p)=>p.id===settingMmrFor)} existing={mmrProfiles[settingMmrFor]} onSave={(profile)=>saveMmr(settingMmrFor,profile)} onClose={()=>setSettingMmrFor(null)}/>}
  <VerificationTab trainingData={trainingData} completions={completions} setCompletions={setCompletions} addToast={addToast} passXP={passXP} setPassXP={setPassXP}/>
      <div style={s.adminHeader}><Shield size={16} color="#FF5C8A"/><span style={s.adminHeaderText}>captain controls</span></div>
      <div style={s.sectionLabel}>set teammate mmr</div>
      <div style={s.sectionSubLabel}>overrides synced data — captain-verified</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:22}}>
        {PLAYERS.filter((p)=>p.id!==ADMIN_ID).map((p)=>(
          <button key={p.id} onClick={()=>setSettingMmrFor(p.id)} className="bb-pressable bb-glow-pink" style={s.adminPlayerRow}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:99,background:p.color}}/><span style={{fontWeight:600}}>{p.name}</span></div>
            <Edit3 size={14} color="#8B92A8"/>
          </button>
        ))}
      </div>
      <div style={s.sectionLabel}>assign training</div>
      <div style={s.sectionSubLabel}>pick a teammate, tap a day</div>
      <div style={s.playerTabRow}>
        {PLAYERS.map((p)=>(<button key={p.id} onClick={()=>setActivePlayerTab(p.id)} className="bb-pressable" style={{...s.playerTabBtn,background:activePlayerTab===p.id?p.color:"rgba(255,255,255,0.05)",color:activePlayerTab===p.id?"#06070D":"#8B92A8"}}>{p.name}</button>))}
      </div>
      {days.map((day)=>{
        const existing=trainingData[tKey(day.key,activePlayer.id)];
        const isToday=day.key===dateKey(today);
        return <button key={day.key} onClick={()=>setAssigning({dateKeyStr:day.key,playerId:activePlayer.id})} className="bb-pressable bb-glow-pink" style={s.adminDayRow}><div><div style={s.adminDayDate}>{fmtDay(day.date)}{isToday&&<span style={{color:"#FF5C8A"}}> · today</span>}</div><div style={s.adminDayTitle}>{existing?existing.title:<span style={{color:"#4A5066"}}>not assigned</span>}</div>{existing?.targetAmount?<div style={s.adminDayMeta}>target: {existing.targetAmount} {existing.unit}</div>:null}</div><Edit3 size={14} color="#8B92A8"/></button>;
      })}
    </div>
  );
}
// ===================== Stats Tab =====================
const STAT_MODES = ["3v3","2v2","1v1"];
const STAT_FIELDS = ["goals","assists","saves","demos","shots","score"];

function StatsTrendLine({ games, field, color }) {
  if (games.length < 2) return null;
  const vals = games.slice(-10).map(g => Number(g[field]) || 0);
  const max = Math.max(...vals, 1);
  const w = 120, h = 36, pad = 4;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
      {vals.map((v,i)=>{
        const x = pad+(i/(vals.length-1))*(w-pad*2);
        const y = h-pad-(v/max)*(h-pad*2);
        return <circle key={i} cx={x} cy={y} r="2.5" fill={color}/>;
      })}
    </svg>
  );
}

function LogGameModal({ mode, currentPlayer, onSave, onClose }) {
  return null;
}

function StatsTab({
function StatsTab({ stats, setStats, currentPlayer, passXP, setPassXP, jumpDate, onJumpHandled }) {
  const [mode,setMode]=useState("3v3");
  const [logging,setLogging]=useState(false);
  const [showAllGames, setShowAllGames]=useState(false);
useEffect(() => {
  if (jumpDate) {
    setMode("3v3");
    setShowAllGames(true);
    setTimeout(() => {
      document.getElementById(`gamelog-${jumpDate}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onJumpHandled();
    }, 100);
  }
}, [jumpDate]);

const saveGame=async(entry)=>{
  const upd=[entry,...stats]; setStats(upd); await storeSet("stats",upd);
  const pts=await storeGet("points")||{};
  let cur=pts[currentPlayer]||0;
  cur+=10;
  const allBets=await storeGet("bets")||[];
  const resolvedBets=allBets.map(bet=>{
    if(bet.status!=="open") return bet;
    if(bet.playerId!==currentPlayer) return bet;
    if(new Date(bet.placedAt)>new Date(entry.ts)) return bet;
    const actual=entry[bet.field]||0;
    const won=bet.side==="over"?actual>bet.line:actual<bet.line;
    if(won){
      pts[bet.bettorId]=(pts[bet.bettorId]||0)+bet.payout;
    }
    return {...bet,status:won?"won":"lost",settledAt:new Date().toISOString(),actual};
  });
  await storeSet("bets",resolvedBets);
await storeSet("points",{...pts,[currentPlayer]:cur});
  const pxp=await storeGet("pass_xp")||{};
  const activeBoosts=await storeGet("pass_active_boosts")||{};
  const mult=getActiveBoostMultiplier(currentPlayer,activeBoosts);
const todayDk = dateKey(new Date(entry.ts));
const todayWins = upd.filter(g => g.mode === "3v3" && g.playerId === currentPlayer && dateKey(new Date(g.ts)) === todayDk && g.ourScore > g.theirScore);
const allTodayGames = upd.filter(g => g.mode === "3v3" && dateKey(new Date(g.ts)) === todayDk);
let streak = 0;
for (let i = allTodayGames.length - 1; i >= 0; i--) {
  if (allTodayGames[i].ourScore > allTodayGames[i].theirScore) streak++;
  else break;
}
const heatMult = heatMultiplier(streak);
const finalMult = mult * heatMult;
const updXP={...pxp,[currentPlayer]:(pxp[currentPlayer]||0)+15*finalMult};
  setPassXP(updXP); await storeSet("pass_xp",updXP);
};
  const modeGames=stats.filter(g=>g.mode===mode);
  const myGames=modeGames.filter(g=>g.playerId===currentPlayer).sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  const avg=(arr,field)=>arr.length?(arr.reduce((s,g)=>s+g[field],0)/arr.length).toFixed(1):"—";
  const winRate=(arr)=>{ if(!arr.length)return"—"; return Math.round((arr.filter(g=>g.ourScore>g.theirScore).length/arr.length)*100)+"%"; };
  const playerColor=PLAYERS.find(p=>p.id===currentPlayer)?.color||"#B8FF4D";
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {logging&&<LogGameModal mode={mode} currentPlayer={currentPlayer} onSave={saveGame} onClose={()=>setLogging(false)}/>}
      <div style={s.sectionRowHeader}>
        <div style={s.sectionLabel}>stats tracker</div>
        <button onClick={()=>setLogging(true)} className="bb-pressable bb-glow-lime" style={s.newPostBtn}><Plus size={14}/> log game</button>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        {STAT_MODES.map(m=>(
          <button key={m} onClick={()=>setMode(m)} className="bb-pressable"
            style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:mode===m?"#B8FF4D":"rgba(255,255,255,0.05)",color:mode===m?"#06070D":"#8B92A8"}}>
            {m}
          </button>
        ))}
      </div>
      <div style={{...s.sectionLabel,marginBottom:10}}>your averages · {myGames.length} games</div>
      {myGames.length===0 ? (
        <div style={s.emptyQueue}>no {mode} games logged yet — tap log game to add one.</div>
      ) : (
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {STAT_FIELDS.map(f=>(
              <div key={f} style={{background:"#11131F",borderRadius:13,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:6,textTransform:"uppercase"}}>{f}</div>
                <div style={{fontSize:22,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:playerColor,marginBottom:6}}>{avg(myGames,f)}</div>
                <StatsTrendLine games={myGames} field={f} color={playerColor}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            <div style={{flex:1,background:"#11131F",borderRadius:13,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.05)",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:4}}>WIN RATE</div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:"#7CFFB2"}}>{winRate(myGames)}</div>
            </div>
            <div style={{flex:1,background:"#11131F",borderRadius:13,padding:"12px 14px",border:"1px solid rgba(255,255,255,0.05)",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:4}}>GAMES</div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:"#E8ECF4"}}>{myGames.length}</div>
            </div>
          </div>
        </>
      )}
      {mode==="3v3"&&(
        <>
          <div style={{...s.sectionLabel,marginBottom:10}}>team comparison</div>
          <div style={{background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.05)",marginBottom:20}}>
            <div style={{display:"grid",gridTemplateColumns:`70px repeat(6,1fr)`,gap:4,marginBottom:8}}>
              <div/>
              {STAT_FIELDS.map(f=><div key={f} style={{fontSize:9.5,color:"#4A5066",fontWeight:700,textAlign:"center",textTransform:"uppercase",letterSpacing:0.5}}>{f}</div>)}
            </div>
            {PLAYERS.map(p=>{
              const pg=modeGames.filter(g=>g.playerId===p.id);
              return (
                <div key={p.id} style={{display:"grid",gridTemplateColumns:`70px repeat(6,1fr)`,gap:4,marginBottom:8,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:7,height:7,borderRadius:99,background:p.color,flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                  </div>
                  {STAT_FIELDS.map(f=><div key={f} style={{fontSize:13,fontWeight:700,color:p.color,textAlign:"center"}}>{avg(pg,f)}</div>)}
                </div>
              );
            })}
          </div>
        </>
      )}
      <div style={{...s.sectionLabel,marginBottom:10}}>your game log</div>
     {[...myGames].reverse().slice(0, showAllGames ? undefined : 5).map(g=>{
  const gdk = dateKey(new Date(g.ts));
        const won=g.ourScore>g.theirScore;
        return (
        <div key={g.id} id={`gamelog-${gdk}`} style={{background:"#11131F",borderRadius:13,padding:"12px 14px",marginBottom:8,border:`1px solid ${won?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700}}>{g.ourScore} – {g.theirScore}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{fontSize:10,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A",background:won?"rgba(124,255,178,0.1)":"rgba(255,92,138,0.1)",padding:"3px 8px",borderRadius:99}}>{won?"WIN":"LOSS"}</div>
                <div style={{fontSize:11,color:"#4A5066"}}>{fmtRelTime(g.ts)}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:12}}>
              {STAT_FIELDS.map(f=>(
                <div key={f} style={{textAlign:"center"}}>
                  <div style={{fontSize:9.5,color:"#4A5066",fontWeight:700,marginBottom:2,textTransform:"uppercase"}}>{f}</div>
                  <div style={{fontSize:14,fontWeight:700,color:playerColor}}>{g[f]}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {myGames.length > 5 && (
        <button onClick={()=>setShowAllGames(v=>!v)} className="bb-pressable"
          style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"11px 0",fontSize:12,fontWeight:700,color:"#8B92A8",cursor:"pointer",marginTop:4}}>
          {showAllGames ? `▲ show less` : `▼ show all ${myGames.length} games`}
        </button>
      )}
    </div>
  );
}
</button>
      )}
    </div>
  );
}

// ===================== Presence + Ping + Notifications + Weekly Recap + Shop =====================
const THEMES = {
  default: {
    id: "default",
    bg: "#06070D", card: "#11131F", border: "rgba(255,255,255,0.06)",
    accent: "#B8FF4D", accentText: "#06070D", text: "#E8ECF4",
    sub: "#8B92A8", muted: "#4A5066", tabBg: "#0A0C16",
    swatch: "linear-gradient(135deg,#06070D 50%,#B8FF4D 50%)",
  },
starfield: {
    id: "starfield",
    bg: "#040818", card: "#0B1230", border: "rgba(100,140,255,0.15)",
    accent: "#7EB8FF", accentText: "#040818", text: "#D8E8FF",
    sub: "#7A90B8", muted: "#3A4E72", tabBg: "#060C1E",
    swatch: "radial-gradient(circle at 30% 40%,#7EB8FF 0%,#040818 70%)",
  },
};
const SHOP_ITEMS = [
  { id:"lime_name",   label:"Lime",   desc:"lime green name glow",   cost:50,  type:"color", value:"#B8FF4D", emoji:"🟢" },
  { id:"pink_name",   label:"Pink",   desc:"hot pink name glow",     cost:50,  type:"color", value:"#FF61C1", emoji:"🩷" },
  { id:"violet_name", label:"Violet", desc:"violet name glow",       cost:50,  type:"color", value:"#A78BFA", emoji:"💜" },
  { id:"gold_name",   label:"Gold",   desc:"gold name glow",         cost:75,  type:"color", value:"#FFD166", emoji:"🌟" },
  { id:"icon_car",    label:"Car",    desc:"rocket car by your name", cost:60,  type:"icon",  value:"🏎️",     emoji:"🏎️" },
  { id:"icon_fire",   label:"Fire",   desc:"you're on fire",         cost:60,  type:"icon",  value:"🔥",     emoji:"🔥" },
  { id:"icon_crown",  label:"Crown",  desc:"for winners only",       cost:100, type:"icon",  value:"👑",     emoji:"👑" },
  { id:"icon_goat",   label:"GOAT",   desc:"greatest of all time",   cost:80,  type:"icon",  value:"🐐",     emoji:"🐐" },
  { id:"icon_bolt",   label:"Bolt",   desc:"fastest on the team",    cost:70,  type:"icon",  value:"⚡",     emoji:"⚡" },
  { id:"icon_alien",  label:"Alien",  desc:"not of this world",      cost:90,  type:"icon",  value:"👾",     emoji:"👾" },
  { id:"title_demogod",            cost:60,  type:"title", value:"demo god",            },
  { id:"title_petty",         cost:60,  type:"title", value:"petty player",        },
  { id:"title_scallions",  cost:100, type:"title", value:"scanlons scallions",  },
  { id:"title_lonely",       cost:70,  type:"title", value:"the lonely girl",     },
  { id:"title_powershot",     cost:75,  type:"title", value:"powershot pimp",      },
  { id:"title_saved",          cost:65,  type:"title", value:"saved the day",       },
  { id:"title_rule69",          cost:69,  type:"title", value:"rule 69",             },
{ id:"title_buffalo",          cost:200,  type:"title", value:"buffalo burton",             },
];
const PASS_PREMIUM_COST = 150;
const PASS_PREMIUM_HEAD_START = 10;
const FREE_TIER_COUNT = 50;
const PREMIUM_TIER_COUNT = 200;
const XP_PER_TIER = 100;
function xpForTier(tier) { return tier * XP_PER_TIER; }

const FREE_PASS_REWARDS = {
  1:  { type:"coins",  value:10,  label:"+10 pts" },
  2:  { type:"icon",   value:"🎯", label:"bullseye icon" },
  3:  { type:"coins",  value:15,  label:"+15 pts" },
  4:  { type:"title",  value:"warming up", label:"warming up" },
  5:  { type:"coins",  value:20,  label:"+20 pts" },
  6:  { type:"icon",   value:"💨", label:"speed icon" },
  7:  { type:"coins",  value:15,  label:"+15 pts" },
  8:  { type:"title",  value:"grinder", label:"grinder" },
  9:  { type:"coins",  value:20,  label:"+20 pts" },
  10: { type:"icon",   value:"📈", label:"trending icon" },
  11: { type:"coins",  value:25,  label:"+25 pts" },
  12: { type:"title",  value:"consistent", label:"consistent" },
  13: { type:"icon",   value:"🧠", label:"big brain icon" },
  14: { type:"coins",  value:20,  label:"+20 pts" },
  15: { type:"title",  value:"on the grind", label:"on the grind" },
  16: { type:"coins",  value:25,  label:"+25 pts" },
  17: { type:"icon",   value:"🎪", label:"showman icon" },
  18: { type:"coins",  value:30,  label:"+30 pts" },
  19: { type:"title",  value:"up and coming", label:"up and coming" },
  20: { type:"token",  value:"training_skip", label:"training skip token" },
  21: { type:"coins",  value:25,  label:"+25 pts" },
  22: { type:"icon",   value:"🔥", label:"fire icon" },
  23: { type:"coins",  value:30,  label:"+30 pts" },
  24: { type:"title",  value:"on the come up", label:"on the come up" },
  25: { type:"coins",  value:50,  label:"+50 pts" },
  26: { type:"icon",   value:"⚡", label:"bolt icon" },
  27: { type:"coins",  value:30,  label:"+30 pts" },
  28: { type:"title",  value:"locked in", label:"locked in" },
  29: { type:"icon",   value:"🎖️", label:"medal icon" },
  30: { type:"token",  value:"training_skip", label:"training skip token" },
  31: { type:"coins",  value:35,  label:"+35 pts" },
  32: { type:"title",  value:"no days off", label:"no days off" },
  33: { type:"icon",   value:"🌙", label:"night owl icon" },
  34: { type:"coins",  value:35,  label:"+35 pts" },
  35: { type:"title",  value:"on the come up", label:"on the come up" },
  36: { type:"color",  value:"#FF8C42", label:"burnt orange glow" },
  37: { type:"coins",  value:40,  label:"+40 pts" },
  38: { type:"icon",   value:"🦅", label:"eagle icon" },
  39: { type:"title",  value:"veteran", label:"veteran" },
  40: { type:"coins",  value:75,  label:"+75 pts" },
  41: { type:"icon",   value:"🎭", label:"mask icon" },
  42: { type:"coins",  value:40,  label:"+40 pts" },
  43: { type:"title",  value:"circuit tested", label:"circuit tested" },
  44: { type:"icon",   value:"🧬", label:"dna icon" },
  45: { type:"token",  value:"training_skip", label:"training skip token" },
  46: { type:"coins",  value:50,  label:"+50 pts" },
  47: { type:"title",  value:"almost there", label:"almost there" },
  48: { type:"icon",   value:"👾", label:"alien icon" },
  49: { type:"coins",  value:60,  label:"+60 pts" },
  50: { type:"title",  value:"burton battler", label:"burton battler" },
};

const PREMIUM_PASS_REWARDS = {
  1:  { type:"coins",  value:20,  label:"+20 pts" },
  2:  { type:"icon",   value:"⚔️", label:"swords icon" },
  3:  { type:"title",  value:"certified demon", label:"certified demon" },
  4:  { type:"coins",  value:25,  label:"+25 pts" },
  5:  { type:"icon",   value:"🌀", label:"vortex icon" },
  6:  { type:"title",  value:"the menace", label:"the menace" },
  7:  { type:"coins",  value:30,  label:"+30 pts" },
  8:  { type:"token",  value:"double_xp", label:"double xp token" },
  9:  { type:"icon",   value:"🎯", label:"target icon" },
  10: { type:"title",  value:"heat seeker", label:"heat seeker" },
  11: { type:"coins",  value:35,  label:"+35 pts" },
  12: { type:"icon",   value:"🛸", label:"ufo icon" },
  13: { type:"title",  value:"ghost protocol", label:"ghost protocol" },
  14: { type:"coins",  value:35,  label:"+35 pts" },
  15: { type:"color",  value:"#FF61C1", label:"hot pink glow" },
  16: { type:"icon",   value:"🦾", label:"cyborg icon" },
  17: { type:"title",  value:"built different", label:"built different" },
  18: { type:"coins",  value:40,  label:"+40 pts" },
  19: { type:"icon",   value:"🌊", label:"wave icon" },
  20: { type:"token",  value:"coaching_session", label:"coaching session token" },
  21: { type:"title",  value:"unstoppable", label:"unstoppable" },
  22: { type:"coins",  value:40,  label:"+40 pts" },
  23: { type:"icon",   value:"🏹", label:"archer icon" },
  24: { type:"title",  value:"calculated", label:"calculated" },
  25: { type:"coins",  value:75,  label:"+75 pts" },
  26: { type:"icon",   value:"🧲", label:"magnet icon" },
  27: { type:"title",  value:"the algorithm", label:"the algorithm" },
  28: { type:"coins",  value:50,  label:"+50 pts" },
  29: { type:"color",  value:"#00FFD0", label:"neon teal glow" },
  30: { type:"token",  value:"training_skip", label:"training skip token" },
  31: { type:"title",  value:"circuit royale", label:"circuit royale" },
  32: { type:"icon",   value:"🔮", label:"crystal ball icon" },
  33: { type:"coins",  value:50,  label:"+50 pts" },
  34: { type:"title",  value:"untouchable", label:"untouchable" },
  35: { type:"icon",   value:"🛡️", label:"shield icon" },
  36: { type:"coins",  value:60,  label:"+60 pts" },
  37: { type:"title",  value:"the operator", label:"the operator" },
  38: { type:"token",  value:"double_xp", label:"double xp token" },
  39: { type:"icon",   value:"🌠", label:"shooting star icon" },
  40: { type:"coins",  value:100, label:"+100 pts" },
  41: { type:"title",  value:"century club", label:"century club" },
  42: { type:"icon",   value:"🎪", label:"big top icon" },
  43: { type:"coins",  value:60,  label:"+60 pts" },
  44: { type:"title",  value:"built in a lab", label:"built in a lab" },
  45: { type:"color",  value:"#FFD166", label:"gold glow" },
  46: { type:"token",  value:"coaching_session", label:"coaching session token" },
  47: { type:"icon",   value:"🛰️", label:"satellite icon" },
  48: { type:"title",  value:"season one legend", label:"season one legend" },
  49: { type:"coins",  value:100, label:"+100 pts" },
  50: { type:"title",  value:"half way there", label:"half way there" },
  51: { type:"icon",   value:"🏔️", label:"mountain icon" },
  52: { type:"coins",  value:60,  label:"+60 pts" },
  53: { type:"title",  value:"the grind never stops", label:"the grind never stops" },
  54: { type:"icon",   value:"⚙️", label:"gear icon" },
  55: { type:"token",  value:"training_skip", label:"training skip token" },
  56: { type:"coins",  value:70,  label:"+70 pts" },
  57: { type:"title",  value:"machine", label:"machine" },
  58: { type:"icon",   value:"🌋", label:"volcano icon" },
  59: { type:"coins",  value:70,  label:"+70 pts" },
  60: { type:"token",  value:"double_xp", label:"double xp token" },
  61: { type:"title",  value:"relentless", label:"relentless" },
  62: { type:"icon",   value:"🎲", label:"dice icon" },
  63: { type:"coins",  value:75,  label:"+75 pts" },
  64: { type:"title",  value:"no cap", label:"no cap" },
  65: { type:"color",  value:"#A78BFA", label:"violet glow" },
  66: { type:"icon",   value:"🦁", label:"lion icon" },
  67: { type:"coins",  value:75,  label:"+75 pts" },
  68: { type:"title",  value:"apex", label:"apex" },
  69: { type:"title",  value:"rule 69", label:"rule 69" },
  70: { type:"token",  value:"coaching_session", label:"coaching session token" },
  71: { type:"icon",   value:"🐉", label:"dragon icon" },
  72: { type:"coins",  value:80,  label:"+80 pts" },
  73: { type:"title",  value:"elite", label:"elite" },
  74: { type:"icon",   value:"🌌", label:"galaxy icon" },
  75: { type:"coins",  value:150, label:"+150 pts" },
  76: { type:"title",  value:"three quarters", label:"three quarters" },
  77: { type:"icon",   value:"🦊", label:"fox icon" },
  78: { type:"coins",  value:80,  label:"+80 pts" },
  79: { type:"title",  value:"nearly mythic", label:"nearly mythic" },
  80: { type:"token",  value:"double_xp", label:"double xp token" },
  81: { type:"icon",   value:"🏆", label:"trophy icon" },
  82: { type:"coins",  value:90,  label:"+90 pts" },
  83: { type:"title",  value:"the real deal", label:"the real deal" },
  84: { type:"icon",   value:"💀", label:"skull icon" },
  85: { type:"color",  value:"#FF5C8A", label:"hot red glow" },
  86: { type:"coins",  value:90,  label:"+90 pts" },
  87: { type:"title",  value:"mythic", label:"mythic" },
  88: { type:"icon",   value:"🌟", label:"star icon" },
  89: { type:"coins",  value:100, label:"+100 pts" },
  90: { type:"token",  value:"coaching_session", label:"coaching session token" },
  91: { type:"title",  value:"penultimate", label:"penultimate" },
  92: { type:"icon",   value:"🔱", label:"trident icon" },
  93: { type:"coins",  value:100, label:"+100 pts" },
  94: { type:"title",  value:"final form", label:"final form" },
  95: { type:"color",  value:"#00FF94", label:"neon green glow" },
  96: { type:"icon",   value:"👑", label:"crown icon" },
  97: { type:"coins",  value:150, label:"+150 pts" },
  98: { type:"title",  value:"burton legend", label:"burton legend" },
  99: { type:"token",  value:"training_skip", label:"training skip token" },
  100:{ type:"title",  value:"century club", label:"century club" },
  // tiers 101-200 continue the grind
  110:{ type:"coins",  value:100, label:"+100 pts" },
  120:{ type:"token",  value:"double_xp", label:"double xp token" },
  125:{ type:"coins",  value:200, label:"+200 pts" },
  130:{ type:"title",  value:"untouchable", label:"untouchable" },
  140:{ type:"color",  value:"#FF8C42", label:"burnt orange glow" },
  150:{ type:"coins",  value:250, label:"+250 pts" },
  160:{ type:"token",  value:"coaching_session", label:"coaching session token" },
  170:{ type:"icon",   value:"🛰️", label:"satellite icon" },
  180:{ type:"title",  value:"built in a lab", label:"built in a lab" },
  190:{ type:"title",  value:"season one legend", label:"season one legend" },
  200:{ type:"car",    value:"🏎️", label:"burton legend car" },
};
const PASS_WEEKLY_FIELDS = ["goals", "assists", "saves", "demos", "shots"];
function getWeeklyPassChallenge(playerId, stats) {
  const idx = PLAYERS.findIndex(p => p.id === playerId);
  const weekNum = Math.floor(Date.now() / WEEK_MS);
  const field = PASS_WEEKLY_FIELDS[(weekNum + idx) % PASS_WEEKLY_FIELDS.length];
  const pg = stats.filter(g => g.playerId === playerId && g.mode === "3v3");
  const avg = pg.length ? pg.reduce((s,g) => s+(g[field]||0), 0)/pg.length : 0;
  const target = Math.round((avg + 1) * 10) / 10;
  return { field, target, weekNum };
}
function tierFromXP(xp, cap) {
  const tier = Math.min(cap, Math.floor(xp / XP_PER_TIER));
  const xpIntoTier = xp - tier * XP_PER_TIER;
  return { tier, xpIntoTier, xpForNext: XP_PER_TIER };
}
const DOUBLE_XP_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
function getActiveBoostMultiplier(playerId, activeBoosts) {
  const boost = activeBoosts?.[playerId];
  if (!boost) return 1;
  if (boost.type !== "double_xp") return 1;
  if (Date.now() > new Date(boost.expiresAt).getTime()) return 1;
  return 2;
}
function isOnline(ts) {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() < 90000;
}

function PlayerNameDisplay({ playerId, points }) {
  const player = PLAYERS.find(p => p.id === playerId);
  if (!player) return null;
  const owned = (points?.[playerId + "_owned"]) || [];
  const equipped = points?.[playerId + "_equipped"] || {};
function getPassRewardValue(ownedId) {
  const parts = ownedId.split("_");
  const t = parts[1]; const tier = Number(parts[2]);
  const rewards = t === "free" ? FREE_PASS_REWARDS : PREMIUM_PASS_REWARDS;
  return rewards[tier] || null;
}
const colorItem = owned.find(id => {
  if (equipped[id]) {
    const shop = SHOP_ITEMS.find(i => i.id === id && i.type === "color");
    if (shop) return true;
    if (id.startsWith("pass_")) { const r = getPassRewardValue(id); return r?.type === "color"; }
  }
  return false;
});
const iconItem = owned.find(id => {
  if (equipped[id]) {
    const shop = SHOP_ITEMS.find(i => i.id === id && i.type === "icon");
    if (shop) return true;
    if (id.startsWith("pass_")) { const r = getPassRewardValue(id); return r?.type === "icon"; }
  }
  return false;
});
const titleItem = owned.find(id => {
  if (equipped[id]) {
    const shop = SHOP_ITEMS.find(i => i.id === id && i.type === "title");
    if (shop) return true;
    if (id.startsWith("pass_")) { const r = getPassRewardValue(id); return r?.type === "title"; }
  }
  return false;
});
const color = colorItem ? (SHOP_ITEMS.find(i => i.id === colorItem)?.value || (colorItem.startsWith("pass_") ? getPassRewardValue(colorItem)?.value : null) || player.color) : player.color;
const icon = iconItem ? (SHOP_ITEMS.find(i => i.id === iconItem)?.value || (iconItem.startsWith("pass_") ? getPassRewardValue(iconItem)?.value : null)) : null;
const title = titleItem ? (SHOP_ITEMS.find(i => i.id === titleItem)?.value || (titleItem.startsWith("pass_") ? getPassRewardValue(titleItem)?.value : null)) : null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:1}}>
      <span style={{ color, fontWeight: 700 }}>{icon && <span style={{ marginRight: 4 }}>{icon}</span>}{player.name}</span>
{title && <span style={{fontSize:9.5,color:"#8B92A8",fontWeight:600,letterSpacing:0.5}}>{title}</span>}
    </div>
  );
}
function PresenceTab({ presence, pings, setPings, currentPlayer, points, setPoints, completions, stats, passXP, setPassXP, passPremium, setPassPremium, passTokens, setPassTokens }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
const [showPass, setShowPass] = useState(false);

  const sendPing = async (toId) => {
    const ping = { id: Date.now().toString(), from: currentPlayer, to: toId, ts: new Date().toISOString(), type: "2s" };
const myExisting = (pings || []).filter(p => p.to === toId);
const others = (pings || []).filter(p => p.to !== toId);
const myUpd = [ping, ...myExisting].slice(0, 2);
const upd = [...myUpd, ...others];
    setPings(upd);
    await storeSet("pings", upd);
  };

  const myPings = (pings || []).filter(p => p.to === currentPlayer && Date.now() - new Date(p.ts).getTime() < 3600000);
  const myPoints = points?.[currentPlayer] || 0;
  const owned = points?.[currentPlayer + "_owned"] || [];
  const equipped = points?.[currentPlayer + "_equipped"] || {};

  const buyItem = async (item) => {
    if (myPoints < item.cost) return;
    if (owned.includes(item.id)) return;
    const upd = { ...points, [currentPlayer]: myPoints - item.cost, [currentPlayer + "_owned"]: [...owned, item.id] };
    setPoints(upd); await storeSet("points", upd);
  };

  const toggleEquip = async (itemId) => {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    const newEquipped = { ...equipped };
    // unequip others of same type
    SHOP_ITEMS.filter(i => i.type === item.type).forEach(i => { delete newEquipped[i.id]; });
    if (!equipped[itemId]) newEquipped[itemId] = true;
    const upd = { ...points, [currentPlayer + "_equipped"]: newEquipped };
    setPoints(upd); await storeSet("points", upd);
  };

  // Weekly recap
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
  const weekStats = PLAYERS.map(p => {
    const pg = stats.filter(g => g.playerId === p.id && new Date(g.ts) >= weekStart);
    const avg = (f) => pg.length ? (pg.reduce((s,g) => s+(g[f]||0), 0)/pg.length).toFixed(1) : 0;
    return { player: p, games: pg.length, goals: avg("goals"), assists: avg("assists"), saves: avg("saves"), demos: avg("demos"), shots: avg("shots") };
  });
  const leaders = ["goals","assists","saves","demos","shots"].map(f => {
    const sorted = [...weekStats].sort((a,b) => Number(b[f]) - Number(a[f]));
    return { field: f, leader: sorted[0] };
  });

  // Notifications feed
  const notifs = [
    ...(pings||[]).filter(p => p.to === currentPlayer).map(p => ({ id:p.id, ts:p.ts, text:`${PLAYERS.find(pl=>pl.id===p.from)?.name} wants to run 2s`, icon:"🎮" })),
    ...(Object.entries(completions||{})).filter(([k,v]) => v.status==="approved" && k.endsWith(`__${currentPlayer}`)).map(([k,v]) => ({ id:k, ts:v.reviewedAt||v.submittedAt, text:`training approved — +15 pts`, icon:"✅" })),
  ].sort((a,b) => new Date(b.ts) - new Date(a.ts)).slice(0, 20);

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {/* Points bar */}
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:2}}>YOUR POINTS</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:600,color:"#B8FF4D"}}>{myPoints}<span style={{fontSize:12,color:"#4A5066",marginLeft:4}}>pts</span></div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowNotifs(v=>!v)} className="bb-pressable" style={{background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"8px 12px",color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer",position:"relative"}}>
            <Bell size={14}/> {notifs.length>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#FF61C1",borderRadius:99,width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff"}}>{notifs.length}</span>}
          </button>
          <button onClick={()=>setShowShop(v=>!v)} className="bb-pressable" style={{background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"8px 12px",color:"#B8FF4D",fontSize:12,fontWeight:700,cursor:"pointer"}}>🛍 shop</button>
<button onClick={()=>setShowPass(v=>!v)} className="bb-pressable" style={{background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"8px 12px",color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer"}}>🎫 pass</button>
          <button onClick={()=>setShowRecap(v=>!v)} className="bb-pressable" style={{background:"rgba(255,209,102,0.1)",border:"1px solid rgba(255,209,102,0.3)",borderRadius:10,padding:"8px 12px",color:"#FFD166",fontSize:12,fontWeight:700,cursor:"pointer"}}>📊 recap</button>
        </div>
      </div>

      {/* Notification center */}
      {showNotifs && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(167,139,250,0.2)"}}>
          <div style={{fontSize:12,color:"#A78BFA",fontWeight:700,letterSpacing:0.5,marginBottom:12}}>NOTIFICATIONS</div>
          {notifs.length===0 && <div style={{color:"#4A5066",fontSize:13}}>nothing yet</div>}
          {notifs.map(n=>(
            <div key={n.id} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <span style={{fontSize:16}}>{n.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:"#E8ECF4"}}>{n.text}</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{fmtRelTime(n.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Weekly recap */}
      {showRecap && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(255,209,102,0.2)"}}>
          <div style={{fontSize:12,color:"#FFD166",fontWeight:700,letterSpacing:0.5,marginBottom:12}}>THIS WEEK'S LEADERS</div>
          {leaders.map(({field,leader})=>(
            <div key={field} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <div style={{fontSize:11,color:"#4A5066",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,width:60}}>{field}</div>
              <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
                <div style={{width:7,height:7,borderRadius:99,background:leader.player.color}}/>
                <span style={{fontSize:13,fontWeight:700,color:leader.player.color}}>{leader.player.name}</span>
              </div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#FFD166"}}>{leader[field]}</div>
              <span style={{fontSize:14,marginLeft:6}}>🏆</span>
            </div>
          ))}
          <div style={{fontSize:11,color:"#4A5066",marginTop:8}}>jackpot: +50 pts awarded sunday night to each category leader</div>
        </div>
      )}
{/* Burton Pass */}
      {showPass && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(167,139,250,0.2)"}}>
          <div style={{fontSize:12,color:"#A78BFA",fontWeight:700,letterSpacing:0.5,marginBottom:4}}>BURTON PASS</div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:14}}>earn pass xp from training approvals (+20) and logged games (+15). view your tiers in the garage tab.</div>

          {(() => {
            const myXP = passXP?.[currentPlayer] || 0;
            const isPremium = !!passPremium?.[currentPlayer];
            const freeProgress = tierFromXP(myXP, FREE_TIER_COUNT);
            const premiumXP = isPremium ? myXP + (PASS_PREMIUM_HEAD_START * XP_PER_TIER) : 0;
            const premiumProgress = tierFromXP(premiumXP, PREMIUM_TIER_COUNT);

            return (
              <>
                <div style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#8B92A8",marginBottom:6}}>
                    <span>free track</span>
                    <span style={{color:"#B8FF4D",fontWeight:700}}>tier {freeProgress.tier} / {FREE_TIER_COUNT}</span>
                  </div>
                  <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${(freeProgress.xpIntoTier/freeProgress.xpForNext)*100}%`,background:"#B8FF4D",borderRadius:99}}/>
                  </div>
                </div>

                {isPremium ? (
                  <div style={{marginBottom:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#8B92A8",marginBottom:6}}>
                      <span>premium track</span>
                      <span style={{color:"#A78BFA",fontWeight:700}}>tier {premiumProgress.tier} / {PREMIUM_TIER_COUNT}</span>
                    </div>
                    <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(premiumProgress.xpIntoTier/premiumProgress.xpForNext)*100}%`,background:"#A78BFA",borderRadius:99}}/>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={async ()=>{
                      const myPoints = points?.[currentPlayer] || 0;
                      if (myPoints < PASS_PREMIUM_COST) return;
                      const updPoints = {...points, [currentPlayer]: myPoints - PASS_PREMIUM_COST};
                      setPoints(updPoints); await storeSet("points", updPoints);
                      const updPremium = {...passPremium, [currentPlayer]: true};
                      setPassPremium(updPremium); await storeSet("pass_premium", updPremium);
                    }}
                    disabled={(points?.[currentPlayer]||0) < PASS_PREMIUM_COST}
                    className="bb-pressable bb-glow-violet"
                    style={{width:"100%",background:(points?.[currentPlayer]||0)>=PASS_PREMIUM_COST?"#A78BFA":"rgba(255,255,255,0.05)",border:"none",borderRadius:10,padding:"12px 0",fontSize:12.5,fontWeight:700,color:(points?.[currentPlayer]||0)>=PASS_PREMIUM_COST?"#06070D":"#4A5066",cursor:(points?.[currentPlayer]||0)>=PASS_PREMIUM_COST?"pointer":"default",marginTop:4}}>
                    unlock premium — {PASS_PREMIUM_COST} pts (instant +{PASS_PREMIUM_HEAD_START} tiers)
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
      {/* Shop */}
      {showShop && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(184,255,77,0.15)"}}>
          <div style={{fontSize:12,color:"#B8FF4D",fontWeight:700,letterSpacing:0.5,marginBottom:4}}>SHOP</div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:12}}>earn pts by logging games (+10) and getting training approved (+15). weekly stat leaders get +50 jackpot.</div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:8}}>NAME COLORS</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
              {SHOP_ITEMS.filter(i=>i.type==="color").map(item=>{
                const isOwned=owned.includes(item.id);
                const isEquipped=equipped[item.id];
                const canAfford=myPoints>=item.cost;
                return (
                  <div key={item.id} style={{background:isEquipped?`${item.value}15`:"rgba(255,255,255,0.03)",borderRadius:13,padding:"12px",border:`1px solid ${isEquipped?item.value:isOwned?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)"}`,position:"relative"}}>
                    {isEquipped&&<div style={{position:"absolute",top:8,right:8,width:6,height:6,borderRadius:99,background:item.value}}/>}
                    <div style={{fontSize:22,marginBottom:6}}>{item.emoji}</div>
                    <div style={{fontSize:13,fontWeight:700,color:isOwned?item.value:"#E8ECF4",marginBottom:2}}>{item.label}</div>
                    <div style={{fontSize:10,color:"#4A5066",marginBottom:10}}>{item.desc}</div>
                    {isOwned?(
                      <button onClick={()=>toggleEquip(item.id)} className="bb-pressable" style={{width:"100%",background:isEquipped?item.value:"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:"6px 0",fontSize:11,fontWeight:700,color:isEquipped?"#06070D":"#8B92A8",cursor:"pointer"}}>
                        {isEquipped?"✓ equipped":"equip"}
                      </button>
                    ):(
                      <button onClick={()=>buyItem(item)} disabled={!canAfford} className="bb-pressable" style={{width:"100%",background:canAfford?"rgba(184,255,77,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:8,padding:"6px 0",fontSize:11,fontWeight:700,color:canAfford?"#B8FF4D":"#4A5066",cursor:canAfford?"pointer":"default"}}>
                        {item.cost} pts
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:8}}>ICONS</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {SHOP_ITEMS.filter(i=>i.type==="icon").map(item=>{
                const isOwned=owned.includes(item.id);
                const isEquipped=equipped[item.id];
                const canAfford=myPoints>=item.cost;
                return (
                  <div key={item.id} style={{background:isEquipped?"rgba(184,255,77,0.08)":"rgba(255,255,255,0.03)",borderRadius:13,padding:"12px 8px",border:`1px solid ${isEquipped?"rgba(184,255,77,0.3)":isOwned?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)"}`,textAlign:"center"}}>
                    <div style={{fontSize:26,marginBottom:4}}>{item.emoji}</div>
                    <div style={{fontSize:11,fontWeight:700,color:isOwned?"#B8FF4D":"#E8ECF4",marginBottom:2}}>{item.label}</div>
                    <div style={{fontSize:9,color:"#4A5066",marginBottom:8}}>{item.desc}</div>
                    {isOwned?(
                      <button onClick={()=>toggleEquip(item.id)} className="bb-pressable" style={{width:"100%",background:isEquipped?"#B8FF4D":"rgba(255,255,255,0.06)",border:"none",borderRadius:7,padding:"5px 0",fontSize:10,fontWeight:700,color:isEquipped?"#06070D":"#8B92A8",cursor:"pointer"}}>
                        {isEquipped?"✓":"equip"}
                      </button>
                    ):(
                      <button onClick={()=>buyItem(item)} disabled={!canAfford} className="bb-pressable" style={{width:"100%",background:canAfford?"rgba(184,255,77,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:7,padding:"5px 0",fontSize:10,fontWeight:700,color:canAfford?"#B8FF4D":"#4A5066",cursor:canAfford?"pointer":"default"}}>
                        {item.cost}pts
                      </button>
                    )}
</div>
                );
              })}
</div>
            <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:8,marginTop:16}}>TITLES</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {SHOP_ITEMS.filter(i=>i.type==="title").map(item=>{
                const isOwned=owned.includes(item.id);
                const isEquipped=equipped[item.id];
                const canAfford=myPoints>=item.cost;
                return (
                  <div key={item.id} style={{background:isEquipped?"rgba(184,255,77,0.08)":"rgba(255,255,255,0.03)",borderRadius:13,padding:"12px",border:`1px solid ${isEquipped?"rgba(184,255,77,0.3)":isOwned?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)"}`,textAlign:"center"}}>
                    <div style={{fontSize:22,marginBottom:4}}>{item.emoji}</div>
                    <div style={{fontSize:11,fontWeight:700,color:isOwned?"#B8FF4D":"#E8ECF4",marginBottom:2}}>{item.label}</div>
                    <div style={{fontSize:9,color:"#4A5066",marginBottom:8}}>{item.value}</div>
                    {isOwned?(
                      <button onClick={()=>toggleEquip(item.id)} className="bb-pressable" style={{width:"100%",background:isEquipped?"#B8FF4D":"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:"6px 0",fontSize:11,fontWeight:700,color:isEquipped?"#06070D":"#8B92A8",cursor:"pointer"}}>
                        {isEquipped?"✓ equipped":"equip"}
                      </button>
                    ):(
                      <button onClick={()=>buyItem(item)} disabled={!canAfford} className="bb-pressable" style={{width:"100%",background:canAfford?"rgba(184,255,77,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:8,padding:"6px 0",fontSize:11,fontWeight:700,color:canAfford?"#B8FF4D":"#4A5066",cursor:canAfford?"pointer":"default"}}>
                        {item.cost} pts
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Online now */}

      {/* Online now */}
      <div style={{...s.sectionLabel,marginBottom:10}}>online now</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
        {PLAYERS.map(p=>{
          const online = isOnline(presence?.[p.id]);
          const isMe = p.id === currentPlayer;
          return (
            <div key={p.id} style={{background:"#11131F",borderRadius:13,padding:"12px 14px",border:`1px solid ${online?"rgba(124,255,178,0.15)":"rgba(255,255,255,0.05)"}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:10,height:10,borderRadius:99,background:online?"#7CFFB2":"#2E3346",boxShadow:online?"0 0 8px #7CFFB299":""}}/>
              <div style={{flex:1}}>
                <PlayerNameDisplay playerId={p.id} points={points}/>
                <div style={{fontSize:11,color:"#4A5066",marginTop:1}}>{online?"online now":presence?.[p.id]?`last seen ${fmtRelTime(presence[p.id])}`:"offline"}</div>
              </div>
              {!isMe && online && (
                <button onClick={()=>sendPing(p.id)} className="bb-pressable bb-glow-lime" style={{background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"7px 12px",fontSize:11,fontWeight:700,color:"#B8FF4D",cursor:"pointer"}}>
                  🎮 run 2s?
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Incoming pings */}
      {myPings.length > 0 && (
        <>
          <div style={{...s.sectionLabel,marginBottom:10}}>squad pings</div>
          {myPings.map(p=>{
            const from = PLAYERS.find(pl=>pl.id===p.from);
            return (
              <div key={p.id} style={{background:"rgba(184,255,77,0.06)",border:"1px solid rgba(184,255,77,0.2)",borderRadius:13,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>🎮</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#B8FF4D"}}>{from?.name} wants to run 2s</div>
                  <div style={{fontSize:11,color:"#4A5066"}}>{fmtRelTime(p.ts)}</div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Team points leaderboard */}
      <div style={{...s.sectionLabel,marginBottom:10}}>points leaderboard</div>
      <div style={{background:"#11131F",borderRadius:13,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}>
        {[...PLAYERS].sort((a,b)=>(points?.[b.id]||0)-(points?.[a.id]||0)).map((p,i)=>(
          <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<PLAYERS.length-1?10:0,paddingBottom:i<PLAYERS.length-1?10:0,borderBottom:i<PLAYERS.length-1?"1px solid rgba(255,255,255,0.04)":"none"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:600,color:i===0?"#FFD166":"#4A5066",width:20}}>{i+1}</div>
            <div style={{width:8,height:8,borderRadius:99,background:p.color}}/>
            <div style={{flex:1,fontSize:13,fontWeight:700}}><PlayerNameDisplay playerId={p.id} points={points}/></div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:p.color}}>{points?.[p.id]||0}<span style={{fontSize:10,color:"#4A5066",marginLeft:3}}>pts</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}    
// ===================== Garage Tab =====================
function GarageTab({ currentPlayer, points, setPoints, passXP, passPremium, passTokens, setPassTokens, passClaimed, setPassClaimed, passActiveBoosts }) {
  const [track, setTrack] = useState("free");
  const [claimResult, setClaimResult] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const passActiveBoostsLocal = passActiveBoosts;

  const myXP = passXP?.[currentPlayer] || 0;
  const isPremium = !!passPremium?.[currentPlayer];
  const playerColor = PLAYERS.find(p => p.id === currentPlayer)?.color || "#B8FF4D";

  const freeProgress = tierFromXP(myXP, FREE_TIER_COUNT);
  const premiumXP = isPremium ? myXP + (PASS_PREMIUM_HEAD_START * XP_PER_TIER) : 0;
  const premiumProgress = tierFromXP(premiumXP, PREMIUM_TIER_COUNT);

  const currentProgress = track === "free" ? freeProgress : premiumProgress;
  const currentCap = track === "free" ? FREE_TIER_COUNT : PREMIUM_TIER_COUNT;
  const currentRewards = track === "free" ? FREE_PASS_REWARDS : PREMIUM_PASS_REWARDS;

  const claimKey = (t, tier) => `${currentPlayer}_${t}_${tier}`;
  const isClaimed = (t, tier) => !!(passClaimed?.[claimKey(t, tier)]);

  const claimReward = async (tier, reward) => {
    const t = track;
    const key = claimKey(t, tier);
    if (isClaimed(t, tier)) return;
    if (currentProgress.tier < tier) return;

    const updClaimed = { ...passClaimed, [key]: true };
    setPassClaimed(updClaimed);
    await storeSet("pass_claimed", updClaimed);

    if (reward.type === "coins") {
      const pts = await storeGet("points") || {};
      const upd = { ...pts, [currentPlayer]: (pts[currentPlayer] || 0) + reward.value };
      setPoints(upd);
      await storeSet("points", upd);
    }

    if (reward.type === "token") {
      const existing = passTokens?.[currentPlayer] || [];
      const newToken = { id: Date.now().toString(), type: reward.value, label: reward.label, earnedAt: new Date().toISOString() };
      const updTokens = { ...passTokens, [currentPlayer]: [...existing, newToken] };
      setPassTokens(updTokens);
      await storeSet("pass_tokens", updTokens);
    }

    if (reward.type === "color" || reward.type === "icon" || reward.type === "title") {
      const owned = points?.[currentPlayer + "_owned"] || [];
      const itemId = `pass_${t}_${tier}`;
      if (!owned.includes(itemId)) {
        const upd = { ...points, [currentPlayer + "_owned"]: [...owned, itemId] };
        setPoints(upd);
        await storeSet("points", upd);
      }
    }

    setClaimResult({ tier, reward });
    setTimeout(() => setClaimResult(null), 2500);
  };

const rewardTiers = Object.entries(currentRewards).map(([tier, reward]) => ({ tier: Number(tier), reward })).sort((a, b) => a.tier - b.tier);
const [tiersExpanded, setTiersExpanded] = useState(false);
const visibleTiers = tiersExpanded ? rewardTiers : rewardTiers.slice(0, 5);
  const myTokens = passTokens?.[currentPlayer] || [];

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {claimResult && (
        <div style={{ position: "fixed", top: 80, left: 0, right: 0, margin: "0 auto", width: 220, zIndex: 300, background: "#1A1D2E", border: "1px solid rgba(184,255,77,0.4)", borderRadius: 14, padding: "14px 20px", textAlign: "center", animation: "dropDown .3s cubic-bezier(.2,.8,.2,1)" }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>🎁</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#B8FF4D" }}>tier {claimResult.tier} claimed!</div>
          <div style={{ fontSize: 12, color: "#8B92A8", marginTop: 2 }}>{claimResult.reward.label || claimResult.reward.value}</div>
        </div>
      )}

      {/* XP summary */}
      <div style={{ background: "linear-gradient(135deg,#11131F,#0C0E18)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#A78BFA", fontWeight: 700, letterSpacing: 0.8, marginBottom: 8 }}>BURTON PASS · SEASON 1</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 26, fontWeight: 600, color: playerColor }}>{myXP}<span style={{ fontSize: 12, color: "#4A5066", marginLeft: 4 }}>xp</span></div>
            <div style={{ fontSize: 11, color: "#4A5066", marginTop: 2 }}>+20 per training approval · +15 per game logged</div>
          </div>
          {!isPremium && (
            <div style={{ fontSize: 11, color: "#4A5066", textAlign: "right" }}>
              <div style={{ color: "#A78BFA", fontWeight: 700 }}>free track</div>
              <div>premium locked</div>
            </div>
          )}
          {isPremium && (
            <div style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700, textAlign: "right" }}>
              <div>✓ premium</div>
              <div style={{ color: "#4A5066", fontWeight: 400 }}>both tracks active</div>
            </div>
          )}
        </div>

        {/* Free track bar */}
        <div style={{ marginBottom: isPremium ? 10 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8B92A8", marginBottom: 4 }}>
            <span>free · tier {freeProgress.tier}/{FREE_TIER_COUNT}</span>
            <span style={{ color: "#B8FF4D" }}>{freeProgress.xpIntoTier}/{freeProgress.xpForNext} xp</span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(freeProgress.xpIntoTier / freeProgress.xpForNext) * 100}%`, background: "#B8FF4D", borderRadius: 99 }} />
          </div>
        </div>

        {/* Premium track bar */}
        {isPremium && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8B92A8", marginBottom: 4 }}>
              <span>premium · tier {premiumProgress.tier}/{PREMIUM_TIER_COUNT}</span>
              <span style={{ color: "#A78BFA" }}>{premiumProgress.xpIntoTier}/{premiumProgress.xpForNext} xp</span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(premiumProgress.xpIntoTier / premiumProgress.xpForNext) * 100}%`, background: "#A78BFA", borderRadius: 99 }} />
            </div>
          </div>
        )}
      </div>

      {/* Track selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTrack("free")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", background: track === "free" ? "#B8FF4D" : "rgba(255,255,255,0.05)", color: track === "free" ? "#06070D" : "#8B92A8" }}>
          free track
        </button>
        <button onClick={() => isPremium && setTrack("premium")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: isPremium ? "pointer" : "default", background: track === "premium" ? "#A78BFA" : "rgba(255,255,255,0.05)", color: track === "premium" ? "#06070D" : isPremium ? "#A78BFA" : "#4A5066", opacity: isPremium ? 1 : 0.5 }}>
          {isPremium ? "premium track" : "🔒 premium"}
        </button>
      </div>

      {/* Tier reward list */}
      <div style={{ ...s.sectionLabel, marginBottom: 12 }}>tier rewards</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibleTiers.map(({ tier, reward }) => {
          const unlocked = currentProgress.tier >= tier;
          const claimed = isClaimed(track, tier);
          const isNext = !unlocked && currentProgress.tier === tier - 1;

          let rewardLabel = reward.label || reward.value;
          let rewardEmoji = reward.type === "coins" ? "🪙" : reward.type === "token" ? "🎟" : reward.type === "color" ? "🎨" : reward.type === "icon" ? reward.value : reward.type === "title" ? "📛" : reward.type === "car" ? "🏎️" : "🎁";

          return (
            <div key={tier} style={{ background: claimed ? "rgba(184,255,77,0.05)" : unlocked ? "#11131F" : "rgba(255,255,255,0.02)", borderRadius: 13, padding: "12px 14px", border: `1px solid ${claimed ? "rgba(184,255,77,0.2)" : isNext ? "rgba(167,139,250,0.3)" : unlocked ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}`, display: "flex", alignItems: "center", gap: 12 }}>
              {/* Tier number */}
              <div style={{ width: 38, textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 15, fontWeight: 700, color: unlocked ? (track === "free" ? "#B8FF4D" : "#A78BFA") : "#4A5066" }}>{tier}</div>
                <div style={{ fontSize: 9, color: "#4A5066", fontWeight: 700 }}>TIER</div>
              </div>

              {/* Reward info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>{rewardEmoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: unlocked ? "#E8ECF4" : "#4A5066" }}>{rewardLabel}</span>
                </div>
                <div style={{ fontSize: 10, color: "#4A5066", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{reward.type}{reward.type === "coins" ? ` · +${reward.value} pts` : ""}</div>
              </div>

              {/* Claim button */}
              <div style={{ flexShrink: 0 }}>
                {claimed ? (
                  <div style={{ fontSize: 11, color: "#7CFFB2", fontWeight: 700 }}>✓ claimed</div>
                ) : unlocked ? (
                  <button onClick={() => claimReward(tier, reward)} className="bb-pressable bb-glow-lime"
                    style={{ background: track === "free" ? "#B8FF4D" : "#A78BFA", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 11.5, fontWeight: 700, color: "#06070D", cursor: "pointer" }}>
                    claim
                  </button>
                ) : (
                  <div style={{ fontSize: 10, color: "#4A5066", fontWeight: 700 }}>{tier - currentProgress.tier} tier{tier - currentProgress.tier !== 1 ? "s" : ""} away</div>
                )}
              </div>
            </div>
          );
        })}
<button onClick={() => setTiersExpanded(v => !v)} className="bb-pressable" style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"11px 0",fontSize:12,fontWeight:700,color:"#8B92A8",cursor:"pointer",marginTop:8}}>
  {tiersExpanded ? "▲ collapse tiers" : `▼ show all ${rewardTiers.length} tiers`}
</button>
      </div>

{/* Owned items from pass */}
      {(() => {
        const owned = points?.[currentPlayer + "_owned"] || [];
        const equipped = points?.[currentPlayer + "_equipped"] || {};
        const passOwned = owned.filter(id => id.startsWith("pass_"));
        if (passOwned.length === 0) return null;

        const toggleEquip = async (itemId, type) => {
          const newEquipped = { ...equipped };
          // unequip others of same type
          owned.filter(id => {
            const shopItem = SHOP_ITEMS.find(i => i.id === id);
            return shopItem?.type === type;
          }).forEach(id => delete newEquipped[id]);
          // also unequip other pass items of same type
          passOwned.forEach(id => {
            const r = getPassRewardForOwnedId(id);
            if (r?.type === type) delete newEquipped[id];
          });
          if (!equipped[itemId]) newEquipped[itemId] = true;
          const upd = { ...points, [currentPlayer + "_equipped"]: newEquipped };
          setPoints(upd);
          await storeSet("points", upd);
        };

        const getPassRewardForOwnedId = (ownedId) => {
          // format: pass_free_5 or pass_premium_15
          const parts = ownedId.split("_");
          const t = parts[1];
          const tier = Number(parts[2]);
          const rewards = t === "free" ? FREE_PASS_REWARDS : PREMIUM_PASS_REWARDS;
          return rewards[tier] || null;
        };

        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ ...s.sectionLabel, marginBottom: 10 }}>owned from pass</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {passOwned.map(ownedId => {
                const reward = getPassRewardForOwnedId(ownedId);
                if (!reward) return null;
                const isEquipped = !!equipped[ownedId];
                const emoji = reward.type === "color" ? "🎨" : reward.type === "icon" ? reward.value : reward.type === "title" ? "📛" : "🎁";
                return (
                  <div key={ownedId} style={{ background: isEquipped ? "rgba(184,255,77,0.06)" : "#11131F", borderRadius: 13, padding: "12px 14px", border: `1px solid ${isEquipped ? "rgba(184,255,77,0.25)" : "rgba(255,255,255,0.06)"}`, display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 20 }}>{emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isEquipped ? "#B8FF4D" : "#E8ECF4" }}>{reward.label}</div>
                      <div style={{ fontSize: 10, color: "#4A5066", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{reward.type}</div>
                    </div>
                    {(reward.type === "color" || reward.type === "icon" || reward.type === "title") && (
                      <button onClick={() => toggleEquip(ownedId, reward.type)} className="bb-pressable"
                        style={{ background: isEquipped ? "#B8FF4D" : "rgba(255,255,255,0.06)", border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 11.5, fontWeight: 700, color: isEquipped ? "#06070D" : "#8B92A8", cursor: "pointer" }}>
                        {isEquipped ? "✓ on" : "equip"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {/* Token inventory */}
{/* Token inventory */}
      {myTokens.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...s.sectionLabel, marginBottom: 10 }}>your tokens</div>
          <div style={{ background: "#11131F", borderRadius: 14, padding: 14, border: "1px solid rgba(255,255,255,0.05)" }}>
            {myTokens.map((tok, i) => (
              <button key={tok.id} onClick={()=>setSelectedToken(tok)} className="bb-pressable" style={{ width:"100%", background:"none", border:"none", textAlign:"left", cursor:"pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: i < myTokens.length - 1 ? 10 : 0, paddingBottom: i < myTokens.length - 1 ? 10 : 0, borderBottom: i < myTokens.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize: 18 }}>🎟</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color:"#E8ECF4" }}>{tok.label}</div>
                  <div style={{ fontSize: 10, color: "#4A5066", marginTop: 1 }}>earned {fmtRelTime(tok.earnedAt)} · tap to view</div>
                </div>
                <ChevronRight size={15} color="#4A5066"/>
              </button>
            ))}
          </div>
        </div>
      )}
      {selectedToken && (
        <TokenDetailModal
          token={selectedToken}
          currentPlayer={currentPlayer}
          passTokens={passTokens}
          setPassTokens={setPassTokens}
          activeBoost={passActiveBoostsLocal?.[currentPlayer]}
          onClose={()=>setSelectedToken(null)}
        />
      )}
    </div>
  );
}

function TokenDetailModal({ token, currentPlayer, passTokens, setPassTokens, activeBoost, onClose }) {
  const [activating, setActivating] = useState(false);
  const isDoubleXp = token.type === "double_xp";
  const alreadyActive = activeBoost && activeBoost.type === "double_xp" && Date.now() < new Date(activeBoost.expiresAt).getTime();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!alreadyActive) return;
    const iv = setInterval(() => {
      setRemaining(Math.max(0, new Date(activeBoost.expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(iv);
  }, [alreadyActive, activeBoost]);

  const fmtRemaining = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${h}h ${m}m ${sec}s`;
  };

  const activate = async () => {
    if (alreadyActive || activating) return;
    setActivating(true);
    const now = Date.now();
    const expiresAt = new Date(now + DOUBLE_XP_DURATION_MS).toISOString();
    const activeBoosts = await storeGet("pass_active_boosts") || {};
    const updBoosts = { ...activeBoosts, [currentPlayer]: { type: token.type, label: token.label, activatedAt: new Date(now).toISOString(), expiresAt } };
    await storeSet("pass_active_boosts", updBoosts);
    // consume the token (one-time use)
    const myTokens = passTokens?.[currentPlayer] || [];
    const updTokens = { ...passTokens, [currentPlayer]: myTokens.filter(t => t.id !== token.id) };
    setPassTokens(updTokens);
    await storeSet("pass_tokens", updTokens);
    setActivating(false);
    onClose();
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>🎟 {token.label}</div>
          <button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20} /></button>
        </div>
        {isDoubleXp ? (
          <>
            <div style={{ fontSize: 13.5, color: "#A8B2C4", lineHeight: 1.5, marginBottom: 16 }}>
              activating this doubles all your battle pass xp — training approvals (+20 → +40) and logged games (+15 → +30) — for the next 24 hours. one-time use.
            </div>
            {alreadyActive ? (
              <>
                <div style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 12, padding: 14, textAlign: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700, marginBottom: 6 }}>DOUBLE XP ALREADY ACTIVE</div>
                  <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 20, fontWeight: 700, color: "#E8ECF4" }}>{fmtRemaining(remaining)}</div>
                  <div style={{ fontSize: 10.5, color: "#4A5066", marginTop: 4 }}>remaining</div>
                </div>
                <div style={{ fontSize: 11.5, color: "#4A5066", textAlign: "center" }}>this token is still in your inventory — use it after your current boost ends.</div>
              </>
            ) : (
              <button onClick={activate} disabled={activating} className="bb-pressable bb-glow-violet" style={{ width: "100%", background: "#A78BFA", color: "#06070D", border: "none", borderRadius: 12, padding: 14, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: activating ? 0.6 : 1 }}>
                {activating ? "activating…" : "activate double xp — 24h"}
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13.5, color: "#A8B2C4", lineHeight: 1.5 }}>
            {token.type === "training_skip" ? "use this to skip a single assigned training session without it counting against you — show this to your captain." : token.type === "coaching_session" ? "redeem this with your captain for a 1-on-1 coaching session." : "a reward token earned from the battle pass."}
          </div>
        )}
      </div>
    </div>
  );
}
function StarfieldBg() {
  const stars = Array.from({length:80},(_,i)=>({
    x: (i*137.5)%100, y: (i*97.3)%100,
    r: i%5===0?1.5:i%3===0?1:0.6,
    op: 0.3+((i*73)%100)/200,
    dur: 2+(i%4),
  }));
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
      {stars.map((st,i)=>(
        <div key={i} style={{position:"absolute",left:`${st.x}%`,top:`${st.y}%`,width:st.r*2,height:st.r*2,borderRadius:"50%",background:"#7EB8FF",opacity:st.op,animation:`livePulse ${st.dur}s ease-in-out infinite`,animationDelay:`${(i*0.3)%3}s`}}/>
      ))}
    </div>
  );
}
// ===================== Main App =====================
// Keys to subscribe to for real-time updates
const RT_KEYS = ["chat", "posts", "completions", "training", "schedule", "comments", "stream_profiles", "stats", "presence", "pings", "points", "bets", "pass_xp", "pass_premium", "pass_claimed", "pass_tokens", "pass_active_boosts"];
// ===================== Push Notifications =====================
const VAPID_PUBLIC_KEY = "BEzMZEUUsvCmR-Pu1xQPyxntGBn2rpqy8GfgY_WBZBmyUTP4b3vfCEesyBSfpJ9UJe7-OnmSrKdoDOb8O0IkINE";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    return sub;
  } catch (e) {
    console.error('Push registration failed', e);
    return null;
  }
}

async function sendPush(subscription, title, body) {
  if (!subscription) return;
  try {
    await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, title, body }),
    });
} catch (e) {
    console.error('Push send failed', e);
  }
}
// ===================== Boost Tab =====================
const WHEEL_SEGMENTS = [
  { label: "GOAL 🎯", mult: 2.0, color: "#B8FF4D", prob: 0.22 },
  { label: "SAVE 🧤", mult: 1.5, color: "#7EB8FF", prob: 0.20 },
  { label: "ASSIST 🍀", mult: 1.75, color: "#A78BFA", prob: 0.18 },
  { label: "EPIC SAVE ⭐", mult: 3.0, color: "#FFD166", prob: 0.08 },
  { label: "HAT TRICK 🪖", mult: 4.0, color: "#FF5C8A", prob: 0.05 },
  { label: "DEMO 💥", mult: 0.0, color: "#FF8C42", prob: 0.12 },
  { label: "OWN GOAL 😬", mult: 0.5, color: "#8B92A8", prob: 0.10 },
  { label: "FORFEIT ❌", mult: 0.0, color: "#4A5066", prob: 0.05 },
];

function pickSegment() {
  const r = Math.random();
  let cum = 0;
  for (const seg of WHEEL_SEGMENTS) {
    cum += seg.prob;
    if (r <= cum) return seg;
  }
  return WHEEL_SEGMENTS[0];
}

function calcOdds(pct) {
  if (pct >= 0.5) {
    return { favorite: true, american: `-${Math.round((pct / (1 - pct)) * 100)}`, decimal: (1 / pct).toFixed(2) };
  } else {
    return { favorite: false, american: `+${Math.round(((1 - pct) / pct) * 100)}`, decimal: (1 / pct).toFixed(2) };
  }
}

function calcPayout(wager, decimalOdds) {
  return Math.round(wager * parseFloat(decimalOdds));
}

function BoostTab({ stats, currentPlayer, points, setPoints, bets, setBets }) {
  const [section, setSection] = useState("wheel");
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState(null);
  const [rotation, setRotation] = useState(0);
const [propWager, setPropWager] = useState(10);
  const [selectedProp, setSelectedProp] = useState(null);
  const [propSide, setPropSide] = useState(null);
  const [lineIndexByProp, setLineIndexByProp] = useState({}); // { [propId]: index into lineOptions }

  const myPoints = points?.[currentPlayer] || 0;
  const playerColor = PLAYERS.find(p => p.id === currentPlayer)?.color || "#B8FF4D";

  // Build player props from stats
const PROP_FIELD_CONFIG = {
    goals:   { lines: [0.5, 1.5, 2.5, 3.5] },
    assists: { lines: [0.5, 1.5, 2.5] },
    saves:   { lines: [0.5, 1.5, 2.5, 3.5] },
    shots:   { lines: [0.5, 1.5, 2.5, 3.5, 4.5] },
    demos:   { lines: [0.5, 1.5, 2.5] },
  };

  // Build one prop "card" per player+stat, with all candidate lines and per-line odds precomputed.
  // The card itself doesn't lock a line — the user picks one via the slider in the UI.
  const buildProps = () => {
    const cards = [];
    PLAYERS.filter(p => p.id !== currentPlayer).forEach(player => {
      const pg = stats.filter(g => g.playerId === player.id && g.mode === "3v3");
      if (pg.length < 1) return;
      Object.entries(PROP_FIELD_CONFIG).forEach(([field, { lines: lineVals }]) => {
        const avg = pg.reduce((s, g) => s + (g[field] || 0), 0) / pg.length;
        const lineOptions = lineVals.map(line => {
          const overCount = pg.filter(g => (g[field] || 0) > line).length;
          const overPct = pg.length > 0 ? overCount / pg.length : 0.5;
          const underPct = 1 - overPct;
          const overOdds = calcOdds(Math.max(0.08, Math.min(0.92, overPct)));
          const underOdds = calcOdds(Math.max(0.08, Math.min(0.92, underPct)));
          return { line, overPct, underPct, overOdds, underOdds };
        });
        cards.push({
          id: `${player.id}_${field}`,
          playerId: player.id,
          playerName: player.name,
          playerColor: player.color,
          field,
          avg: avg.toFixed(1),
          gamesPlayed: pg.length,
          lineOptions, // array of {line, overPct, underPct, overOdds, underOdds}
        });
      });
    });
    return cards;
  };

  const props = buildProps();
  const myOpenBets = (bets || []).filter(b => b.bettorId === currentPlayer && b.status === "open");
  const mySettledBets = (bets || []).filter(b => b.bettorId === currentPlayer && b.status !== "open");

  const spinWheel = async () => {
    if (spinning || wager < 1 || myPoints < wager) return;
    setSpinning(true);
    setSpinResult(null);
    const seg = pickSegment();
const spins = 5 + Math.random() * 3;
const segIdx = WHEEL_SEGMENTS.indexOf(seg);
const segAngle = 360 / WHEEL_SEGMENTS.length;
// Segment i sits at angle (i * segAngle) measured from 12 o'clock, clockwise.
// To bring that segment's center UNDER the fixed pointer at 12 o'clock,
// we need to rotate the wheel by the negative of that angle (plus full spins).
const segCenterAngle = segIdx * segAngle + segAngle / 2;
const jitter = (Math.random() - 0.5) * (segAngle * 0.6); // stay within the wedge, off-center a bit
const targetAngle = spins * 360 - segCenterAngle - jitter;
setRotation(prev => {
  // normalize so we always spin forward a fresh amount from current visual position
  const current = prev % 360;
  const delta = ((targetAngle - current) % 360 + 360) % 360 + spins * 360;
  return prev + delta;
});
    setTimeout(async () => {
      const payout = Math.round(wager * seg.mult);
      const net = payout - wager;
      const newPts = Math.max(0, myPoints - wager + payout);
      const upd = { ...points, [currentPlayer]: newPts };
      setPoints(upd);
      await storeSet("points", upd);
      setSpinResult({ seg, wager, payout, net });
      setSpinning(false);
    }, 3000);
  };

const placeBet = async (chosenLine) => {
    if (!selectedProp || !propSide || propWager < 1 || myPoints < propWager) return;
    const card = props.find(p => p.id === selectedProp);
    if (!card) return;
    const lineIdx = lineIndexByProp[selectedProp] ?? Math.floor(card.lineOptions.length/2);
    const current = card.lineOptions[lineIdx];
    const line = chosenLine ?? current.line;
    const odds = propSide === "over" ? current.overOdds : current.underOdds;
    const payout = calcPayout(propWager, odds.decimal);
    const bet = {
      id: Date.now().toString(),
      bettorId: currentPlayer,
      playerId: card.playerId,
      playerName: card.playerName,
      field: card.field,
      line,
      side: propSide,
      wager: propWager,
      payout,
      odds: odds.american,
      status: "open",
      placedAt: new Date().toISOString(),

    };
    const newPts = myPoints - propWager;
    const upd = { ...points, [currentPlayer]: newPts };
    setPoints(upd);
    await storeSet("points", upd);
    const updBets = [...(bets || []), bet];
    setBets(updBets);
    await storeSet("bets", updBets);
    setSelectedProp(null);
    setPropSide(null);
    setPropWager(10);
  };

  const segAngle = 360 / WHEEL_SEGMENTS.length;

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:2}}>YOUR BALANCE</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:600,color:"#B8FF4D"}}>{myPoints}<span style={{fontSize:12,color:"#4A5066",marginLeft:4}}>pts</span></div>
        </div>
        <div style={{fontSize:11,color:"#4A5066",textAlign:"right"}}>
          <div style={{color:"#FFD166",fontWeight:700,fontSize:13}}>{myOpenBets.length} open bets</div>
          <div style={{marginTop:2}}>{mySettledBets.length} settled</div>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        {[{id:"wheel",label:"🎡 wheel"},{id:"props",label:"📊 props"},{id:"mybets",label:"🎟 my bets"}].map(sec=>(
          <button key={sec.id} onClick={()=>setSection(sec.id)} className="bb-pressable"
            style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:section===sec.id?"#B8FF4D":"rgba(255,255,255,0.05)",color:section===sec.id?"#06070D":"#8B92A8"}}>
            {sec.label}
          </button>
        ))}
      </div>

      {/* WHEEL */}
      {section==="wheel"&&(
        <div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>spin the rocket wheel — instant payout. bet your coins, take your chances.</div>

          {/* Wheel visual */}
          <div style={{position:"relative",width:260,height:260,margin:"0 auto 24px"}}>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",zIndex:10,width:32,height:32,background:"#06070D",borderRadius:"50%",border:"2px solid #B8FF4D",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>▼</div>
            <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",borderRadius:"50%",overflow:"hidden",border:"3px solid rgba(184,255,77,0.3)",transition:spinning?"transform 3s cubic-bezier(0.17,0.67,0.12,0.99)":"none",transform:`rotate(${rotation}deg)`}}>
              {WHEEL_SEGMENTS.map((seg, i) => {
                const angle = i * segAngle;
                return (
                  <div key={i} style={{position:"absolute",top:"50%",left:"50%",width:"50%",height:2,transformOrigin:"left center",transform:`rotate(${angle}deg)`,background:seg.color,opacity:0.6}}/>
                );
              })}
              <svg viewBox="0 0 200 200" style={{width:"100%",height:"100%"}}>
                {WHEEL_SEGMENTS.map((seg, i) => {
                  const startAngle = (i * segAngle - 90) * Math.PI / 180;
                  const endAngle = ((i + 1) * segAngle - 90) * Math.PI / 180;
                  const x1 = 100 + 100 * Math.cos(startAngle);
                  const y1 = 100 + 100 * Math.sin(startAngle);
                  const x2 = 100 + 100 * Math.cos(endAngle);
                  const y2 = 100 + 100 * Math.sin(endAngle);
                  const midAngle = ((i + 0.5) * segAngle - 90) * Math.PI / 180;
                  const tx = 100 + 65 * Math.cos(midAngle);
                  const ty = 100 + 65 * Math.sin(midAngle);
                  return (
                    <g key={i}>
                      <path d={`M100,100 L${x1},${y1} A100,100 0 0,1 ${x2},${y2} Z`} fill={seg.color} opacity="0.85"/>
                      <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="#06070D" fontWeight="bold" transform={`rotate(${(i+0.5)*segAngle}, ${tx}, ${ty})`}>{seg.mult}x</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Wager input */}
          <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:14,border:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:10}}>YOUR WAGER</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[5,10,25,50,100].map(amt=>(
                <button key={amt} onClick={()=>setWager(amt)} className="bb-pressable"
                  style={{flex:1,background:wager===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"7px 0",fontSize:11,fontWeight:700,color:wager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
                  {amt}
                </button>
              ))}
            </div>
            <input type="number" value={wager} onChange={e=>setWager(Math.max(1,Number(e.target.value)))} style={{...s.modalInput,textAlign:"center",fontSize:18,fontFamily:"'Oswald',sans-serif"}}/>
          </div>

          {spinResult&&(
            <div style={{background:spinResult.net>=0?"rgba(124,255,178,0.08)":"rgba(255,92,138,0.08)",border:`1px solid ${spinResult.net>=0?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.3)"}`,borderRadius:14,padding:14,marginBottom:14,textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:4}}>{spinResult.seg.label}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,fontWeight:700,color:spinResult.net>=0?"#7CFFB2":"#FF5C8A"}}>{spinResult.net>=0?"+":""}{spinResult.net} pts</div>
              <div style={{fontSize:11,color:"#4A5066",marginTop:4}}>{spinResult.seg.mult}x · wagered {spinResult.wager} · got {spinResult.payout}</div>
            </div>
          )}

          <button onClick={spinWheel} disabled={spinning||myPoints<wager||wager<1} className="bb-pressable bb-glow-lime"
            style={{...s.primaryBtn,opacity:spinning||myPoints<wager?0.4:1,fontFamily:"'Oswald',sans-serif",fontSize:16,letterSpacing:1}}>
            {spinning?"spinning…":"spin"}
          </button>

          {/* Odds table */}
          <div style={{marginTop:20,background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}>
            <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:10}}>PAYOUT TABLE</div>
            {WHEEL_SEGMENTS.map(seg=>(
              <div key={seg.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <div style={{fontSize:13}}>{seg.label}</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:seg.mult>=2?"#7CFFB2":seg.mult>0?"#B8FF4D":"#FF5C8A"}}>{seg.mult}x</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PROPS */}
   {/* PROPS */}
      {section==="props"&&(
        <div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>bet on your teammates' stats. drag the line to set your bet — odds update live based on their actual averages. resolves when they log a 3v3 game.</div>
          {props.length===0&&<div style={s.emptyQueue}>not enough game data yet — props unlock after teammates log 3v3 games.</div>}
          {props.map(card=>{
            const lineIdx = lineIndexByProp[card.id] ?? Math.floor(card.lineOptions.length/2);
            const current = card.lineOptions[lineIdx];
            const isSelected = selectedProp===card.id;
            return (
              <div key={card.id} style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:`1px solid ${isSelected?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.05)"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <div style={{width:8,height:8,borderRadius:99,background:card.playerColor}}/>
                  <span style={{fontWeight:700,fontSize:13,color:card.playerColor}}>{card.playerName}</span>
                  <span style={{fontSize:13,fontWeight:700,color:"#E8ECF4",marginLeft:4}}>· {card.field}</span>
                  <span style={{fontSize:11,color:"#4A5066",marginLeft:"auto"}}>avg: {card.avg} ({card.gamesPlayed}g)</span>
                </div>

                {/* Line slider */}
                <div style={{margin:"14px 0 12px"}}>
                  <div style={{textAlign:"center",marginBottom:8}}>
                    <span style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#E8ECF4"}}>{current.line}</span>
                    <span style={{fontSize:12,color:"#4A5066",marginLeft:6}}>{card.field}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={card.lineOptions.length-1}
                    step={1}
                    value={lineIdx}
                    onChange={(e)=>{
                      const idx=Number(e.target.value);
                      setLineIndexByProp(p=>({...p,[card.id]:idx}));
                      if (isSelected) setPropSide(null); // force re-pick of side when line changes mid-selection
                    }}
                    style={{width:"100%",accentColor:card.playerColor}}
                  />
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                    {card.lineOptions.map((opt,i)=>(
                      <span key={opt.line} style={{fontSize:9,color:i===lineIdx?"#8B92A8":"#3A4256",fontWeight:i===lineIdx?700:400}}>{opt.line}</span>
                    ))}
                  </div>
                </div>

                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setSelectedProp(card.id);setPropSide("over");}} className="bb-pressable"
                    style={{flex:1,background:isSelected&&propSide==="over"?"#7CFFB2":"rgba(124,255,178,0.08)",border:`1px solid ${isSelected&&propSide==="over"?"#7CFFB2":"rgba(124,255,178,0.2)"}`,borderRadius:10,padding:"10px 0",cursor:"pointer"}}>
                    <div style={{fontSize:10,color:"#4A5066",fontWeight:700,marginBottom:2}}>OVER {current.line}</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:isSelected&&propSide==="over"?"#06070D":"#7CFFB2"}}>{current.overOdds.american}</div>
                  </button>
                  <button onClick={()=>{setSelectedProp(card.id);setPropSide("under");}} className="bb-pressable"
                    style={{flex:1,background:isSelected&&propSide==="under"?"#FF5C8A":"rgba(255,92,138,0.08)",border:`1px solid ${isSelected&&propSide==="under"?"#FF5C8A":"rgba(255,92,138,0.2)"}`,borderRadius:10,padding:"10px 0",cursor:"pointer"}}>
                    <div style={{fontSize:10,color:"#4A5066",fontWeight:700,marginBottom:2}}>UNDER {current.line}</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:isSelected&&propSide==="under"?"#06070D":"#FF5C8A"}}>{current.underOdds.american}</div>
                  </button>
                </div>
              </div>
            );
          })}

          {selectedProp&&propSide&&(
            <div style={{position:"sticky",bottom:0,background:"#0A0C16",borderTop:"1px solid rgba(255,255,255,0.08)",padding:"14px 0",marginTop:8}}>
              <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:8}}>WAGER AMOUNT</div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {[5,10,25,50].map(amt=>(
                  <button key={amt} onClick={()=>setPropWager(amt)} className="bb-pressable"
                    style={{flex:1,background:propWager===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"7px 0",fontSize:11,fontWeight:700,color:propWager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
                    {amt}
                  </button>
                ))}
              </div>
              {(() => {
                const card = props.find(p => p.id === selectedProp);
                const lineIdx = lineIndexByProp[selectedProp] ?? Math.floor((card?.lineOptions.length||1)/2);
                const current = card?.lineOptions[lineIdx];
                const odds = propSide === "over" ? current?.overOdds : current?.underOdds;
                const payout = odds ? calcPayout(propWager, odds.decimal) : 0;
                return (
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{flex:1,background:"rgba(184,255,77,0.06)",borderRadius:10,padding:"10px 12px",border:"1px solid rgba(184,255,77,0.15)"}}>
                      <div style={{fontSize:10,color:"#4A5066",marginBottom:2}}>TO WIN</div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#B8FF4D"}}>{payout} pts</div>
                    </div>
                    <button onClick={()=>placeBet(current?.line)} disabled={myPoints<propWager} className="bb-pressable bb-glow-lime"
                      style={{flex:1,background:"#B8FF4D",border:"none",borderRadius:10,padding:"14px 0",fontSize:13,fontWeight:700,color:"#06070D",cursor:"pointer",opacity:myPoints<propWager?0.4:1}}>
                      place bet
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

          {selectedProp&&propSide&&(
            <div style={{position:"sticky",bottom:0,background:"#0A0C16",borderTop:"1px solid rgba(255,255,255,0.08)",padding:"14px 0",marginTop:8}}>
              <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:8}}>WAGER AMOUNT</div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {[5,10,25,50].map(amt=>(
                  <button key={amt} onClick={()=>setPropWager(amt)} className="bb-pressable"
                    style={{flex:1,background:propWager===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"7px 0",fontSize:11,fontWeight:700,color:propWager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
                    {amt}
                  </button>
                ))}
              </div>
              {(() => {
                const prop = props.find(p => p.id === selectedProp);
                const odds = propSide === "over" ? prop?.overOdds : prop?.underOdds;
                const payout = odds ? calcPayout(propWager, odds.decimal) : 0;
                return (
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{flex:1,background:"rgba(184,255,77,0.06)",borderRadius:10,padding:"10px 12px",border:"1px solid rgba(184,255,77,0.15)"}}>
                      <div style={{fontSize:10,color:"#4A5066",marginBottom:2}}>TO WIN</div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#B8FF4D"}}>{payout} pts</div>
                    </div>
                    <button onClick={placeBet} disabled={myPoints<propWager} className="bb-pressable bb-glow-lime"
                      style={{flex:1,background:"#B8FF4D",border:"none",borderRadius:10,padding:"14px 0",fontSize:13,fontWeight:700,color:"#06070D",cursor:"pointer",opacity:myPoints<propWager?0.4:1}}>
                      place bet
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* MY BETS */}
      {section==="mybets"&&(
        <div>
          {myOpenBets.length===0&&mySettledBets.length===0&&<div style={s.emptyQueue}>no bets yet — head to props or spin the wheel.</div>}
          {myOpenBets.length>0&&(
            <>
              <div style={{...s.sectionLabel,marginBottom:10}}>open bets</div>
              {myOpenBets.map(bet=>(
                <div key={bet.id} style={{background:"#11131F",borderRadius:13,padding:14,marginBottom:8,border:"1px solid rgba(255,209,102,0.2)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:700,color:"#FFD166"}}>{bet.playerName} {bet.side} {bet.line} {bet.field}</span>
                    <span style={{fontSize:11,color:"#4A5066"}}>{bet.odds}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:12,color:"#8B92A8"}}>wagered {bet.wager} pts</span>
                    <span style={{fontSize:12,color:"#B8FF4D",fontWeight:700}}>win {bet.payout} pts</span>
                  </div>
                  <div style={{fontSize:10,color:"#4A5066",marginTop:4}}>waiting for {bet.playerName} to log a 3v3 game</div>
                </div>
              ))}
            </>
          )}
          {mySettledBets.length>0&&(
            <>
              <div style={{...s.sectionLabel,marginBottom:10,marginTop:16}}>settled</div>
              {mySettledBets.map(bet=>{
                const won = bet.status==="won";
                return (
                  <div key={bet.id} style={{background:"#11131F",borderRadius:13,padding:14,marginBottom:8,border:`1px solid ${won?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontSize:13,fontWeight:700}}>{bet.playerName} {bet.side} {bet.line} {bet.field}</span>
                      <span style={{fontSize:11,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A"}}>{won?"WON":"LOST"}</span>
                    </div>
                    <div style={{fontSize:12,color:"#8B92A8"}}>wagered {bet.wager} · {won?`+${bet.payout-bet.wager} profit`:`-${bet.wager} loss`}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [authStage,setAuthStage]=useState("select");
  const [selectedPlayerId,setSelectedPlayerId]=useState(null);
  const [currentPlayer,setCurrentPlayer]=useState(null);
const [toasts, setToasts] = useState([]);
  const [loading,setLoading]=useState(false);
  const [tab,setTab]=useState("home");
  const [schedule,setSchedule]=useState({league:buildLeagueWeeks(),playoffs:buildPlayoffRounds()});
  const [mmrProfiles,setMmrProfiles]=useState({});
  const [trainingData,setTrainingData]=useState({});
  const [completions,setCompletions]=useState({});
  const [messages,setMessages]=useState([]);
  const [comments,setComments]=useState({});
  const [posts,setPosts]=useState([]);
  const [streamProfiles,setStreamProfiles]=useState({});
  const [stats,setStats]=useState([]);
  const [presence,setPresence]=useState({});
  const [pings,setPings]=useState([]);
  const [points,setPoints]=useState({});
const [bets,setBets]=useState([]);
  const [resyncingId,setResyncingId]=useState(null);
const [passXP, setPassXP] = useState({});       // { [playerId]: number }
const [passPremium, setPassPremium] = useState({}); // { [playerId]: true }
const [passClaimed, setPassClaimed] = useState({}); // { [playerId+"_"+track+"_"+tier]: true }
const [passTokens, setPassTokens] = useState({});   // { [playerId]: [{id,type,label,earnedAt}] }
const [passActiveBoosts, setPassActiveBoosts] = useState({}); // { [playerId]: {type,label,activatedAt,expiresAt} }
  const [resyncOverlay,setResyncOverlay]=useState(false);
  const [pendingResyncPlayer,setPendingResyncPlayer]=useState(null);
  const [commentDay,setCommentDay]=useState(null);
  const [jumpKey,setJumpKey]=useState(null);
  const [bannerDismissed,setBannerDismissed]=useState(false);
  const [pushSub, setPushSub] = useState(null);
const [themeId, setThemeId] = useState("default");
const [lastSeen, setLastSeen] = useState({social:0, chat:0, training:0});
const [showAllGames, setShowAllGames] = useState(false);
const [statsJumpDate, setStatsJumpDate] = useState(null);
const [chatOpen, setChatOpen] = useState(false);
const theme = THEMES[themeId];
const addToast = (text, icon = "🔔") => {
  const id = Date.now().toString();
  setToasts(prev => [...prev, { id, text, icon }]);
  setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
};

  // ── Real-time: subscribe to all shared KV keys once logged in ──
  useEffect(() => {
    if (!currentPlayer) return;
    const heartbeat = async () => {
      const upd = { ...presence, [currentPlayer]: new Date().toISOString() };
      await storeSet("presence", upd);
    };
heartbeat();
    const hbInterval = setInterval(heartbeat, 30000);
    const unsub = subscribeKVMulti(RT_KEYS, ({ key, value }) => {
      if (key === "chat")           setMessages(value);
      if (key === "posts")          setPosts(value);
      if (key === "completions")    setCompletions(value);
      if (key === "training")       setTrainingData(value);
      if (key === "schedule")       setSchedule(value);
      if (key === "comments")       setComments(value);
      if (key === "stream_profiles") setStreamProfiles(value);
       if (key === "stats")           setStats(value);
      if (key === "presence")        setPresence(value);
      if (key === "pings")           setPings(value);
      if (key === "points")          setPoints(value);
if (key === "bets")            setBets(value);
if (key === "pass_xp")      setPassXP(value);
if (key === "pass_premium") setPassPremium(value);
if (key === "pass_claimed") setPassClaimed(value);
if (key === "pass_tokens")  setPassTokens(value);
      if (key === "pass_active_boosts") setPassActiveBoosts(value);
    });
     return () => { unsub(); clearInterval(hbInterval); };
  }, [currentPlayer]);

  const selectName=async(pid)=>{ setSelectedPlayerId(pid); const auth=await storeGet(`auth:${pid}`); setAuthStage(auth?"enter":"create"); };

const loadSharedData=async(pid)=>{
    setLoading(true);
   const [sched,training,comp,chat,cmts,pst,strm,sts,prs,pngs,pts,bts,pxp,ppm,pcl,ptk,pab]=await Promise.all([
storeGet("schedule"),storeGet("training"),storeGet("completions"),storeGet("chat"),storeGet("comments"),storeGet("posts"),storeGet("stream_profiles"),storeGet("stats"),storeGet("presence"),storeGet("pings"),storeGet("points"),storeGet("bets"),storeGet("pass_xp"),storeGet("pass_premium"),storeGet("pass_claimed"),storeGet("pass_tokens"),storeGet("pass_active_boosts"),
]);
    if (sched) setSchedule(sched);
    if (training) setTrainingData(training);
    if (comp) setCompletions(comp);
    if (chat) setMessages(chat);
    if (cmts) setComments(cmts);
    if (pst) setPosts(pst);
    if (strm) setStreamProfiles(strm);
    if (sts) setStats(sts);
    if (prs) setPresence(prs);
    if (pngs) setPings(pngs);
if (pts) setPoints(pts);  
if (bts) setBets(bts);
if (pxp) setPassXP(pxp);
if (ppm) setPassPremium(ppm);
if (pcl) setPassClaimed(pcl);
if (ptk) setPassTokens(ptk);
if (pab) setPassActiveBoosts(pab);
const savedLastSeen = await storeGet(`lastSeen:${pid}`);
if (savedLastSeen) setLastSeen(savedLastSeen);
else setLastSeen({social:0, chat:0, training:0});
    const profiles={};
    for (const p of PLAYERS) { const profile=await getMMR(p.id); if(profile) profiles[p.id]=profile; }
    setMmrProfiles(profiles);
      setCurrentPlayer(pid);
setMmrProfiles(prev => ({...prev}));
    if (!profiles[pid]) setAuthStage("tracker"); else setAuthStage("app");
    setLoading(false);
  };

  const handleResync=(pid)=>{ setPendingResyncPlayer(pid); setResyncOverlay(true); setResyncingId(pid); };
  const finishResync=async()=>{
    const pid=pendingResyncPlayer; const existing=mmrProfiles[pid];
    if (existing) {
      const newRanks=existing.ranks.map((r)=>{ const mmr=r.mmr+Math.floor(Math.random()*16-8); return {...r,mmr,rank:rankFromMMR(mmr)}; });
      const profile={...existing,ranks:newRanks,lastSynced:new Date().toISOString(),source:existing.source==="admin"?"admin":"synced"};
      setMmrProfiles((prev)=>({...prev,[pid]:profile}));
      await setMMR(pid,profile);
    }
    setResyncOverlay(false); setResyncingId(null);
  };

  const incompleteDays=(()=>{
    if (!currentPlayer) return [];
    const today=todayAtMidnight(); const out=[];
    Object.keys(trainingData).forEach((k)=>{ const [dk,pid]=k.split("__"); if(pid!==currentPlayer)return; const date=new Date(dk+"T00:00:00"); if(date>=today)return; const comp=completions[tKey(dk,currentPlayer)]; if(!comp) out.push({key:dk,date,training:trainingData[k]}); });
    return out.sort((a,b)=>a.date-b.date);
  })();

const touchStartY = useRef(0);
  const scrollContainerRef = useRef(null);
  const handleTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const handleTouchEnd = (e) => {
    if (tab !== "home") return; // only allow pull-to-refresh on the home tab
    const el = scrollContainerRef.current;
    if (el && el.scrollTop > 4) return; // only when already scrolled to the very top
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 220) loadSharedData(currentPlayer); // raised threshold, much less sensitive
  };
  if (authStage==="select") return <><GlobalStyles/><NameSelectScreen onSelect={selectName}/></>;
  const selectedPlayer=PLAYERS.find((p)=>p.id===selectedPlayerId);
  if (authStage==="create") return <><GlobalStyles/><CreatePasscodeScreen player={selectedPlayer} onCreated={()=>loadSharedData(selectedPlayerId)}/></>;
  if (authStage==="enter") return <><GlobalStyles/><EnterPasscodeScreen player={selectedPlayer} onSuccess={()=>loadSharedData(selectedPlayerId)} onBack={()=>setAuthStage("select")}/></>;
  if (loading) return <><GlobalStyles/><div style={{...s.screen,alignItems:"center",justifyContent:"center"}}><div style={{color:"#4A5066",fontSize:13,letterSpacing:1}}>loading team data…</div></div></>;
  if (authStage==="tracker") return <><GlobalStyles/><TrackerSetup player={selectedPlayer} onComplete={async()=>{ const profile=await getMMR(selectedPlayerId); setMmrProfiles((prev)=>({...prev,[selectedPlayerId]:profile})); setAuthStage("app"); }}/></>;
  const playerObj=PLAYERS.find((p)=>p.id===currentPlayer);
  const isAdmin=currentPlayer===ADMIN_ID;
const TABS=[
    {id:"home",icon:Home,label:"home"},
    {id:"bracket",icon:Trophy,label:"bracket"},
    {id:"training",icon:Dumbbell,label:"training"},
    {id:"social",icon:ImageIcon,label:"social"},
    {id:"stream",icon:Tv,label:"stream"},
      {id:"stats",icon:BarChart2,label:"stats"},
{id:"presence",icon:Circle,label:"squad"},
{id:"boost",icon:Dice5,label:"boost"},
{id:"garage",icon:Trophy,label:"garage"},
 ...(isAdmin?[{id:"admin",icon:Shield,label:"admin"}]:[]),
  ];
const badges = {
    social: Math.max(0, posts.length - lastSeen.social),
    chat: Math.max(0, messages.length - lastSeen.chat),
    training: Math.max(0, Object.keys(completions).filter(k => k.endsWith(`__${currentPlayer}`) && completions[k].status==="pending").length - lastSeen.training),
  };

  return (
<div style={{...s.appShell, background:theme.bg, color:theme.text}}>
      <GlobalStyles/>
{theme.id==="starfield" && <StarfieldBg/>}
{toasts.length > 0 && (
  <div style={{position:"fixed",top:"max(60px,env(safe-area-inset-top))",left:"50%",transform:"translateX(-50%)",zIndex:999,display:"flex",flexDirection:"column",gap:8,width:"calc(100% - 32px)",maxWidth:440,pointerEvents:"none"}}>
    {toasts.map(t=>(
      <div key={t.id} style={{background:"#1A1D2E",border:"1px solid rgba(184,255,77,0.25)",borderRadius:13,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",animation:"dropDown .3s cubic-bezier(.2,.8,.2,1)"}}>
        <span style={{fontSize:18}}>{t.icon}</span>
        <span style={{fontSize:13,fontWeight:600,color:"#E8ECF4"}}>{t.text}</span>
      </div>
    ))}
  </div>
)}
      {resyncOverlay&&<SyncOverlay onDone={finishResync} label="syncing rocket league data"/>}
      {commentDay&&<CommentsModal dayKey={commentDay} comments={comments} setComments={setComments} currentPlayer={currentPlayer} onClose={()=>setCommentDay(null)}/>}
 <div style={s.topBar}>
  <div style={s.topBarTitle}>
    <button onClick={async()=>{ 
      const sub = await registerPush();
      if (sub) {
        setPushSub(sub);
        storeSet(`push_sub:${currentPlayer}`, JSON.stringify(sub));
        alert('notifications enabled!');
      } else {
        alert('notifications blocked or not supported');
      }
    }} className="bb-pressable" style={{background:"none",border:"none",color:"#B8FF4D",fontSize:11,fontWeight:700,cursor:"pointer",padding:"4px 8px"}}>
      enable notifs
    </button>
  </div>
<div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",alignItems:"center",gap:6}}>
  {isAdmin&&<Shield size={13} color="#FF5C8A"/>}
  <div style={{...s.youDot,background:playerObj.color,boxShadow:`0 0 8px ${playerObj.color}99`}}/>
  <span style={s.youName}>{playerObj.name}</span>
</div>
<div style={s.topBarRight}>
  <button onClick={()=>setChatOpen(true)} className="bb-pressable" style={{...s.logoutBtn,position:"relative"}}>
    <MessageCircle size={16}/>
    {Math.max(0, messages.length - lastSeen.chat) > 0 && (
      <div style={{position:"absolute",top:-3,right:-4,background:"#FF5C8A",borderRadius:99,minWidth:13,height:13,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",padding:"0 3px"}}>
        {Math.max(0, messages.length - lastSeen.chat)}
      </div>
    )}
  </button>
  <button onClick={()=>{ setCurrentPlayer(null); setAuthStage("select"); setSelectedPlayerId(null); setTab("home"); setBannerDismissed(false); }} className="bb-pressable" style={s.logoutBtn}><LogOut size={15}/></button>
  <div style={{display:"flex",gap:5,alignItems:"center",marginLeft:4}}>
    {Object.values(THEMES).map(t=>(
      <button key={t.id} onClick={()=>setThemeId(t.id)}
        style={{width:16,height:16,borderRadius:"50%",border:themeId===t.id?"2px solid #fff":"2px solid transparent",background:t.swatch,cursor:"pointer",padding:0,flexShrink:0,outline:"none"}}
      />
    ))}
  </div>
</div>
</div>
      {!bannerDismissed&&<ReminderBanner incompleteDays={incompleteDays} onJump={(key)=>{ setTab("training"); setJumpKey(key); setBannerDismissed(true); }} onDismiss={()=>setBannerDismissed(true)}/>}
      <div ref={scrollContainerRef} style={{...s.tabBody, position:"relative", zIndex:1}} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
{tab==="home"&&<HomeTab schedule={schedule} mmrProfiles={mmrProfiles} currentPlayer={currentPlayer} onResync={handleResync} resyncingId={resyncingId} trainingData={trainingData} completions={completions} onGotoTraining={()=>setTab("training")} stats={stats} setCompletions={setCompletions} onGotoStats={()=>setTab("stats")} statsJumpDate={statsJumpDate} setStatsJumpDate={setStatsJumpDate} passXP={passXP} setPassXP={setPassXP}/>}
        {tab==="bracket"&&<BracketTab schedule={schedule} setSchedule={setSchedule} currentPlayer={currentPlayer}/>}
        {tab==="training"&&<TrainingTab trainingData={trainingData} completions={completions} setCompletions={setCompletions} currentPlayer={currentPlayer} onOpenComments={setCommentDay} jumpKey={jumpKey} onJumpHandled={()=>setJumpKey(null)}/>}
       {tab==="social"&&<SocialTab posts={posts} setPosts={setPosts} currentPlayer={currentPlayer} addToast={addToast}/>}
        {tab==="chat"&&<ChatTab messages={messages} setMessages={setMessages} currentPlayer={currentPlayer} addToast={addToast}/>}
        {tab==="stream"&&<StreamTab streamProfiles={streamProfiles} setStreamProfiles={setStreamProfiles} currentPlayer={currentPlayer}/>}
{tab==="stats"&&<StatsTab stats={stats} setStats={setStats} currentPlayer={currentPlayer} passXP={passXP} setPassXP={setPassXP} jumpDate={statsJumpDate} onJumpHandled={()=>setStatsJumpDate(null)}/>}
 {tab==="boost"&&<BoostTab stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} bets={bets} setBets={setBets}/>}       
{tab==="presence"&&<PresenceTab presence={presence} pings={pings} setPings={setPings} currentPlayer={currentPlayer} points={points} setPoints={setPoints} completions={completions} stats={stats} passXP={passXP} setPassXP={setPassXP} passPremium={passPremium} setPassPremium={setPassPremium} passTokens={passTokens} setPassTokens={setPassTokens}/>}
{tab==="garage"&&<GarageTab currentPlayer={currentPlayer} points={points} setPoints={setPoints} passXP={passXP} passPremium={passPremium} passTokens={passTokens} setPassTokens={setPassTokens} passClaimed={passClaimed} setPassClaimed={setPassClaimed} passActiveBoosts={passActiveBoosts}/>}
   {tab==="admin"&&isAdmin&&<AdminTab trainingData={trainingData} setTrainingData={setTrainingData} mmrProfiles={mmrProfiles} setMmrProfiles={setMmrProfiles} addToast={addToast} completions={completions} setCompletions={setCompletions} passXP={passXP} setPassXP={setPassXP}/>}
      </div>
      {chatOpen && (
        <div style={{position:"fixed",inset:0,zIndex:500,background:"#06070D",display:"flex",flexDirection:"column",animation:"chatFadeIn .18s ease"}}>
          <div style={{animation:"chatSlideIn .32s cubic-bezier(.2,.8,.2,1)",flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",paddingTop:"max(14px, env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
              <button onClick={()=>{
                setChatOpen(false);
                const upd={...lastSeen,chat:messages.length}; setLastSeen(upd); storeSet(`lastSeen:${currentPlayer}`,upd);
              }} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                <ChevronLeft size={18}/>
              </button>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600}}>team chat</div>
            </div>
            <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column"}}>
              <ChatTab messages={messages} setMessages={setMessages} currentPlayer={currentPlayer} addToast={addToast}/>
            </div>
          </div>
        </div>
      )}
   <div style={s.tabBar}>
        {TABS.map((t)=>(
        <button key={t.id} onClick={()=>{
            setTab(t.id);
            if (t.id==="social") { const upd={...lastSeen,social:posts.length}; setLastSeen(upd); storeSet(`lastSeen:${currentPlayer}`,upd); }
            if (t.id==="training") { const upd={...lastSeen,training:Object.keys(completions).filter(k=>k.endsWith(`__${currentPlayer}`)&&completions[k].status==="pending").length}; setLastSeen(upd); storeSet(`lastSeen:${currentPlayer}`,upd); }
          }} className="bb-pressable" style={s.tabBtn}>
            <div style={{position:"relative",display:"inline-flex"}}>
              <t.icon size={18} color={tab===t.id?(t.id==="admin"||t.id==="verify"?"#FF5C8A":"#B8FF4D"):"#4A5066"} style={tab===t.id?{filter:`drop-shadow(0 0 6px ${t.id==="admin"||t.id==="verify"?"#FF5C8A":"#B8FF4D"})`}:{}}/>
              {badges[t.id]>0&&<div style={{position:"absolute",top:-4,right:-6,background:"#FF5C8A",borderRadius:99,minWidth:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",padding:"0 3px"}}>{badges[t.id]}</div>}
            </div>
            <span style={{color:tab===t.id?(t.id==="admin"||t.id==="verify"?"#FF5C8A":"#B8FF4D"):"#4A5066",fontSize:9,fontWeight:600}}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===================== Styles =====================
const s = {
appShell:{display:"flex",flexDirection:"column",height:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"'Inter',-apple-system,sans-serif",width:"100%",position:"relative",overflow:"hidden"},
  screen:{height:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"},
topBar:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px 12px",paddingTop:"max(14px, env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,position:"relative"},
  topBarTitle:{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600,letterSpacing:0.8,textTransform:"lowercase"},
  topBarRight:{display:"flex",alignItems:"center",gap:8},
  youDot:{width:8,height:8,borderRadius:99},
  youName:{fontSize:13,color:"#8B92A8"},
  logoutBtn:{background:"none",border:"none",color:"#4A5066",padding:4,marginLeft:4,cursor:"pointer"},
  tabBody:{flex:1,overflowY:"auto",overflowX:"hidden",paddingBottom:8,WebkitOverflowScrolling:"touch",minHeight:0},
  tabContent:{padding:"16px 16px 24px"},
tabBar:{display:"flex",borderTop:"1px solid rgba(255,255,255,0.06)",background:"#0A0C16",flexShrink:0,paddingBottom:"env(safe-area-inset-bottom,0px)"},
  tabBtn:{flex:1,background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 2px 8px",cursor:"pointer",minWidth:0,overflow:"hidden"},
  reminderBanner:{display:"flex",alignItems:"center",gap:6,padding:"10px 14px",background:"rgba(255,92,138,0.08)",borderBottom:"1px solid rgba(255,92,138,0.2)",animation:"dropDown .3s cubic-bezier(.2,.8,.2,1)",flexShrink:0},
  reminderBtn:{flex:1,display:"flex",alignItems:"center",gap:10,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"},
  reminderTitle:{fontSize:12.5,fontWeight:700,color:"#FF5C8A"},
  reminderSub:{fontSize:11.5,color:"#8B92A8",marginTop:1},
  reminderClose:{background:"none",border:"none",color:"#8B92A8",padding:4,cursor:"pointer",flexShrink:0},
  loginScreen:{height:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"},
  loginGlow:{position:"absolute",top:"-15%",left:"50%",transform:"translateX(-50%)",width:520,height:520,background:"radial-gradient(circle,rgba(184,255,77,0.10),rgba(167,139,250,0.06) 50%,transparent 75%)",pointerEvents:"none"},
  loginContent:{position:"relative",zIndex:1,padding:"32px 28px",width:"100%",maxWidth:420,textAlign:"center"},
  backBtn:{position:"absolute",top:18,left:18,background:"none",border:"none",color:"#8B92A8",fontSize:12.5,display:"flex",alignItems:"center",gap:2,cursor:"pointer"},
  loginEyebrow:{fontSize:11,letterSpacing:2,color:"#B8FF4D",fontWeight:600,marginBottom:14,textShadow:"0 0 12px rgba(184,255,77,0.5)"},
  loginTitle:{fontFamily:"'Oswald',sans-serif",fontSize:36,fontWeight:600,lineHeight:1.08,letterSpacing:0.5,marginBottom:8,textTransform:"lowercase"},
  loginSub:{color:"#8B92A8",fontSize:14,marginBottom:28},
  loginPlayerGrid:{display:"flex",flexDirection:"column",gap:10},
  loginPlayerBtn:{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:"#11131F",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,color:"#E8ECF4",fontSize:15,fontWeight:600,cursor:"pointer",width:"100%"},
  loginPlayerDot:{width:10,height:10,borderRadius:99},
  loginCodeWrap:{marginTop:20,display:"flex",flexDirection:"column",gap:10},
  loginInput:{background:"#11131F",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"14px 16px",color:"#E8ECF4",fontSize:16,textAlign:"center",letterSpacing:4,outline:"none",width:"100%"},
  loginError:{color:"#FF5C8A",fontSize:12},
  loginSubmit:{background:"#B8FF4D",color:"#06070D",border:"none",borderRadius:12,padding:"14px",fontSize:13.5,fontWeight:700,letterSpacing:0.5,display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",width:"100%"},
  syncOverlay:{position:"fixed",inset:0,background:"rgba(6,7,13,0.96)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,backdropFilter:"blur(4px)"},
  syncBox:{width:"80%",maxWidth:320,textAlign:"center"},
  syncSpinner:{width:38,height:38,borderRadius:"50%",border:"3px solid rgba(184,255,77,0.15)",borderTopColor:"#B8FF4D",margin:"0 auto 22px",animation:"spin .9s linear infinite"},
  syncTitle:{fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1.2,color:"#B8FF4D",marginBottom:18,fontWeight:600},
  syncBarTrack:{height:4,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden",marginBottom:10},
  syncBarFill:{height:"100%",background:"#B8FF4D",transition:"width .18s ease",borderRadius:99,boxShadow:"0 0 8px rgba(184,255,77,0.6)"},
  syncPct:{fontSize:12,color:"#4A5066",fontFamily:"monospace"},
  setupWrap:{padding:"60px 28px",display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:6,flex:1},
  setupTitle:{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:600,marginTop:0},
  setupSub:{color:"#8B92A8",fontSize:14,marginBottom:20,lineHeight:1.4},
  setupRow:{display:"flex",gap:8,marginBottom:16,width:"100%"},
  platformBtn:{flex:1,border:"none",borderRadius:9,padding:"10px 0",fontSize:12,fontWeight:700,cursor:"pointer"},
  setupInput:{width:"100%",background:"#11131F",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"14px 16px",color:"#E8ECF4",fontSize:15,marginBottom:16,outline:"none",boxSizing:"border-box"},
  primaryBtn:{width:"100%",background:"#B8FF4D",color:"#06070D",border:"none",borderRadius:12,padding:"14px",fontSize:13.5,fontWeight:700,cursor:"pointer",marginTop:4},
  heroCard:{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:18,padding:"20px 18px",marginBottom:16},
  heroEyebrow:{fontSize:11,letterSpacing:1.2,color:"#B8FF4D",fontWeight:700,marginBottom:14},
  heroMatchup:{display:"flex",alignItems:"center",justifyContent:"space-between"},
  heroTeam:{flex:1,textAlign:"center"},
  heroTeamName:{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:600,lineHeight:1.15,textTransform:"lowercase"},
  heroVs:{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 10px",color:"#4A5066",fontSize:12,fontWeight:700},
  heroBo:{fontSize:10,color:"#A78BFA",marginBottom:2,fontWeight:700},
  heroMeta:{textAlign:"center",marginTop:14,fontSize:12,color:"#8B92A8"},
  recordRow:{display:"flex",gap:10,marginBottom:24},
  recordBox:{flex:1,background:"#11131F",borderRadius:14,padding:"14px 8px",textAlign:"center",border:"1px solid rgba(255,255,255,0.05)"},
  recordNum:{fontFamily:"'Oswald',sans-serif",fontSize:21,fontWeight:600},
  recordLabel:{fontSize:9.5,letterSpacing:0.6,color:"#4A5066",marginTop:4,fontWeight:700},
  sectionRowHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10},
  sectionLabel:{fontSize:12,letterSpacing:1,color:"#4A5066",fontWeight:700,marginBottom:4},
  sectionSubLabel:{fontSize:12,color:"#4A5066",marginBottom:14},
  viewAllBtn:{background:"none",border:"none",color:"#A78BFA",fontSize:11.5,fontWeight:600,display:"flex",alignItems:"center",gap:2,cursor:"pointer"},
  dashTrainingScroll:{display:"flex",gap:10,overflowX:"auto",paddingBottom:6,marginBottom:4,WebkitOverflowScrolling:"touch"},
  dashTrainingCard:{minWidth:122,background:"#11131F",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"12px 12px",cursor:"pointer",flexShrink:0},
  dashTrainingDay:{fontSize:10.5,color:"#A78BFA",fontWeight:700,textTransform:"lowercase",marginBottom:6},
  dashTrainingTitle:{fontSize:12.5,fontWeight:600,lineHeight:1.3,marginBottom:8,minHeight:32},
  dashTrainingEmpty:{fontSize:11.5,color:"#3A4256",fontStyle:"italic",minHeight:32,display:"flex",alignItems:"center"},
  dashDoneTag:{fontSize:9.5,color:"#7CFFB2",fontWeight:700,display:"flex",alignItems:"center",gap:3},
  dashOpenTag:{fontSize:9.5,color:"#B8FF4D",fontWeight:700},
  dashPendingTag:{fontSize:9.5,color:"#FFD166",fontWeight:700},
  dashRejectedTag:{fontSize:9.5,color:"#FF5C8A",fontWeight:700},
  dashLockedTag:{fontSize:9.5,color:"#4A5066",fontWeight:700},
  blurredText:{filter:"blur(5px)",userSelect:"none",pointerEvents:"none"},
  mmrCard:{background:"#11131F",borderRadius:16,padding:14,marginBottom:10,border:"1px solid rgba(255,255,255,0.05)"},
  mmrCardEmpty:{background:"#11131F",borderRadius:16,padding:16,marginBottom:10},
  mmrCardHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12},
  verifiedBadge:{fontSize:9,color:"#FF5C8A",fontWeight:700,background:"rgba(255,92,138,0.1)",padding:"2px 6px",borderRadius:99,marginLeft:4},
  resyncBtn:{background:"rgba(255,255,255,0.06)",border:"none",color:"#8B92A8",fontSize:11,fontWeight:700,padding:"5px 10px",borderRadius:7,cursor:"pointer"},
  mmrGrid:{display:"flex",gap:8},
  mmrItem:{flex:1,textAlign:"center",background:"rgba(255,255,255,0.025)",borderRadius:11,padding:"10px 4px"},
  mmrPlaylist:{fontSize:9.5,color:"#4A5066",marginBottom:6,fontWeight:600},
  mmrRank:{fontSize:12,fontWeight:700,marginBottom:2},
  mmrNum:{fontSize:10.5,color:"#4A5066",fontFamily:"monospace"},
  mmrSynced:{fontSize:10.5,color:"#2E3346",marginTop:10,textAlign:"right"},
  matchRow:{width:"100%",background:"#11131F",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,padding:"13px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",textAlign:"left"},
  matchRowWeek:{fontSize:11,color:"#B8FF4D",fontWeight:700,marginBottom:2},
  matchRowOpp:{fontSize:15,fontWeight:600,color:"#E8ECF4"},
  matchRowDate:{fontSize:11.5,color:"#4A5066",marginTop:2},
  matchRowRight:{display:"flex",alignItems:"center",gap:10},
  matchRowScore:{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700},
  matchRowStatus:{fontSize:9.5,fontWeight:700,border:"1px solid",borderRadius:99,padding:"3px 8px",letterSpacing:0.5},
  hintText:{fontSize:12,color:"#4A5066",textAlign:"center",marginTop:16},
  modalOverlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200},
modalBox:{background:"#11131F",borderRadius:"22px 22px 0 0",padding:20,width:"100%",maxWidth:480,boxSizing:"border-box",border:"1px solid rgba(255,255,255,0.06)",borderBottom:"none",maxHeight:"88vh",overflowY:"auto",paddingBottom:"max(80px, calc(env(safe-area-inset-bottom) + 60px))"},
  modalHeader:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16},
  modalTitle:{fontFamily:"'Oswald',sans-serif",fontSize:17,fontWeight:600},
  modalClose:{background:"none",border:"none",color:"#8B92A8",cursor:"pointer"},
  modalLabel:{fontSize:11,letterSpacing:0.6,color:"#4A5066",fontWeight:700,marginBottom:6,marginTop:12},
  modalInput:{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"11px 12px",color:"#E8ECF4",fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"},
  modalStatusGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8},
  modalStatusBtn:{border:"none",borderRadius:9,padding:"10px 0",fontSize:11.5,fontWeight:700,cursor:"pointer"},
  modalScoreRow:{display:"flex",gap:10},
  numericToggle:{width:"100%",display:"flex",alignItems:"center",gap:10,border:"1px solid",borderRadius:10,padding:"11px 12px",fontSize:12.5,color:"#A8B2C4",cursor:"pointer",marginTop:14,textAlign:"left",lineHeight:1.35},
  checkbox:{width:18,height:18,borderRadius:5,border:"2px solid",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  trainingCard:{background:"#11131F",borderRadius:16,padding:16,marginBottom:12,position:"relative",border:"1px solid rgba(255,255,255,0.05)"},
  trainingCardHeader:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10},
  trainingDate:{fontSize:14,fontWeight:700},
  todayBadge:{fontSize:9.5,color:"#A78BFA",fontWeight:700,letterSpacing:0.5,marginTop:2},
  allDoneBadge:{display:"flex",alignItems:"center",gap:4,fontSize:10.5,color:"#7CFFB2",fontWeight:700,background:"rgba(124,255,178,0.1)",padding:"3px 8px",borderRadius:99},
  pendingBadge:{display:"flex",alignItems:"center",gap:4,fontSize:10.5,color:"#FFD166",fontWeight:700,background:"rgba(255,209,102,0.1)",padding:"3px 8px",borderRadius:99},
  rejectedBadge:{display:"flex",alignItems:"center",gap:4,fontSize:10.5,color:"#FF5C8A",fontWeight:700,background:"rgba(255,92,138,0.1)",padding:"3px 8px",borderRadius:99},
  lockedText:{fontSize:13,color:"#4A5066",fontStyle:"italic"},
  lockedFooter:{fontSize:11.5,color:"#4A5066",marginTop:10,fontStyle:"italic"},
  trainingTitle:{fontSize:16,fontWeight:700,marginBottom:6},
  trainingDesc:{fontSize:13.5,color:"#A8B2C4",lineHeight:1.5,marginBottom:8},
  packCode:{fontSize:12.5,color:"#8B92A8",fontFamily:"monospace",marginBottom:12},
  rejectNote:{fontSize:12.5,color:"#E8ECF4",background:"rgba(255,92,138,0.08)",border:"1px solid rgba(255,92,138,0.2)",borderRadius:9,padding:"8px 10px",marginBottom:12,lineHeight:1.4},
  trainingActions:{display:"flex",gap:8},
  completeBtn:{flex:1,border:"none",borderRadius:11,padding:"11px 0",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer"},
  commentBtn:{width:42,background:"rgba(255,255,255,0.05)",border:"none",borderRadius:11,color:"#8B92A8",cursor:"pointer"},
  numericWrap:{marginTop:4},
  numericLabel:{fontSize:11.5,color:"#A78BFA",fontWeight:700,marginBottom:10},
  numericCounter:{display:"flex",alignItems:"center",justifyContent:"center",gap:18,background:"rgba(255,255,255,0.03)",borderRadius:13,padding:"10px 0"},
  counterBtn:{width:36,height:36,borderRadius:99,background:"rgba(255,255,255,0.07)",border:"none",color:"#E8ECF4",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"},
  counterVal:{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:600,minWidth:50,textAlign:"center"},
  chatTabWrap:{display:"flex",flexDirection:"column",height:"100%"},
  chatHeader:{padding:"16px 16px 8px",flexShrink:0},
  chatScroll:{flex:1,overflowY:"auto",padding:"0 16px",WebkitOverflowScrolling:"touch"},
  chatEmpty:{textAlign:"center",color:"#4A5066",fontSize:13,marginTop:40},
  chatMsgRow:{display:"flex",marginBottom:10},
  chatBubble:{maxWidth:"78%",borderRadius:15,padding:"9px 13px"},
  chatAuthor:{fontSize:11,fontWeight:700,marginBottom:3},
  chatText:{fontSize:14.5,lineHeight:1.4},
  chatTime:{fontSize:10,marginTop:4,textAlign:"right"},
  chatInputRow:{display:"flex",gap:8,padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",flexShrink:0},
  chatInput:{flex:1,background:"#11131F",border:"1px solid rgba(255,255,255,0.1)",borderRadius:99,padding:"11px 16px",color:"#E8ECF4",fontSize:14,outline:"none"},
  chatSendBtn:{width:42,height:42,background:"#B8FF4D",border:"none",borderRadius:99,color:"#06070D",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0},
  commentItem:{display:"flex",gap:8,marginBottom:14},
  newPostBtn:{display:"flex",alignItems:"center",gap:5,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#A78BFA",fontSize:12,fontWeight:700,padding:"7px 12px",borderRadius:99,cursor:"pointer"},
  emptyQueue:{textAlign:"center",color:"#4A5066",fontSize:13,marginTop:30,lineHeight:1.5,padding:"0 10px"},
  postCard:{background:"#11131F",borderRadius:16,marginBottom:14,border:"1px solid rgba(255,255,255,0.05)",overflow:"hidden"},
  postHeader:{display:"flex",alignItems:"center",gap:8,padding:"12px 14px 10px"},
  postTime:{fontSize:11,color:"#4A5066",marginLeft:"auto"},
  postImage:{width:"100%",display:"block",maxHeight:360,objectFit:"cover",background:"#06070D"},
  postCaption:{fontSize:13.5,color:"#E8ECF4",lineHeight:1.45,padding:"10px 14px 4px"},
  postActions:{display:"flex",gap:16,padding:"10px 14px 12px"},
  postActionBtn:{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:0},
  imagePickBtn:{width:"100%",minHeight:140,background:"rgba(255,255,255,0.03)",border:"1px dashed rgba(255,255,255,0.15)",borderRadius:14,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",marginTop:4},
  imagePreview:{width:"100%",maxHeight:240,objectFit:"cover",borderRadius:10},
  adminHeader:{display:"flex",alignItems:"center",gap:8,marginBottom:18},
  adminHeaderText:{fontSize:13,fontWeight:700,color:"#FF5C8A",letterSpacing:0.5},
  adminPlayerRow:{width:"100%",background:"#11131F",border:"1px solid rgba(255,92,138,0.15)",borderRadius:13,padding:"13px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"},
  playerTabRow:{display:"flex",gap:8,marginBottom:14},
  playerTabBtn:{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:11.5,fontWeight:700,cursor:"pointer"},
  adminDayRow:{width:"100%",background:"#11131F",border:"1px solid rgba(255,255,255,0.05)",borderRadius:13,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:8,textAlign:"left"},
  adminDayDate:{fontSize:12,color:"#8B92A8",fontWeight:600,marginBottom:3},
  adminDayTitle:{fontSize:14,fontWeight:600},
  adminDayMeta:{fontSize:11,color:"#A78BFA",marginTop:3},
  verifyPlayerHeader:{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,0.06)"},
  verifyCount:{fontSize:11,color:"#FFD166",fontWeight:700,marginLeft:"auto"},
  verifyCard:{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:"1px solid rgba(255,255,255,0.05)"},
  verifyCardTop:{display:"flex",justifyContent:"space-between",marginBottom:6},
  verifyDate:{fontSize:12,color:"#A78BFA",fontWeight:700},
  verifySubmittedAt:{fontSize:11,color:"#4A5066"},
  verifyTitle:{fontSize:15,fontWeight:700,marginBottom:4},
  verifyAmount:{fontSize:13,color:"#8B92A8"},
  verifyActionsRow:{display:"flex",gap:8},
  rejectBtn:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",color:"#FF5C8A",borderRadius:10,padding:"10px 0",fontSize:12.5,fontWeight:700,cursor:"pointer"},
  approveBtn:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"#B8FF4D",border:"none",color:"#06070D",borderRadius:10,padding:"10px 0",fontSize:12.5,fontWeight:700,cursor:"pointer"},
  streamEmbed:{width:"100%",aspectRatio:"16/9",background:"#000",borderRadius:14,overflow:"hidden",marginBottom:12},
  streamBelowEmbed:{textAlign:"right",marginBottom:16},
  twitchLink:{color:"#9146FF",fontSize:12.5,fontWeight:700,textDecoration:"none"},
  twitchEditCard:{background:"#11131F",border:"1px solid rgba(167,139,250,0.2)",borderRadius:14,padding:14,marginBottom:16},
  streamPlayerCard:{background:"#11131F",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,padding:"14px 16px",display:"flex",alignItems:"center",gap:12},
  watchBtn:{display:"flex",alignItems:"center",gap:6,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#A78BFA",fontSize:12.5,fontWeight:700,padding:"8px 14px",borderRadius:99,cursor:"pointer",flexShrink:0},
  offlineChip:{fontSize:11,color:"#4A5066",fontWeight:700,background:"rgba(255,255,255,0.04)",padding:"4px 10px",borderRadius:99},
  streamNote:{background:"rgba(167,139,250,0.06)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:14,padding:14,marginTop:20},
};
