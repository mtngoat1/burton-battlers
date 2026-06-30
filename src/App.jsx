import {
  Home, Lock, Check, ChevronRight, Send, X, Plus, Minus, Trophy, Dumbbell,
  MessageCircle, LogOut, Shield, Edit3, ChevronLeft, Image as ImageIcon,
  Heart, ClipboardCheck, Bell, ThumbsDown, ThumbsUp, Clock, Tv, Circle, BarChart2, Dice5,
} from "lucide-react";
import { storeGet, storeSet, getMMR, setMMR, uploadPostImage, subscribeKVMulti } from "./lib/storage";
import { useState, useEffect, useRef, useCallback } from "react";

// ===================== Constants =====================
const ADMIN_ID = "p1";
const PLAYERS = [
  { id: "p1", name: "maglvxx",  color: "#B8FF4D", twitch: "", platform: "psn" },
  { id: "p2", name: "apcards5", color: "#4D9EFF", twitch: "", platform: "xbl" },
  { id: "p3", name: "tqr11le",  color: "#FF61C1", twitch: "", platform: "xbl" },
];
const TRAINING_START = new Date("2026-07-01T00:00:00");
const LEAGUE_START   = new Date("2026-07-20T00:00:00");
const PLAYOFF_START  = new Date("2026-08-24T00:00:00");
const PLAYOFF_END    = new Date("2026-09-21T23:59:59");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS  = 24 * 60 * 60 * 1000;
const STOCK_BASE_PRICE = 100;
const PARSE_CREDITS_DEFAULT = 50;
const PARSE_RESERVE_DEFAULT = 50;

const WEEKLY_EVENTS = [
  { id:"double_xp", emoji:"🔥", title:"Double Pass XP Week", desc:"all pass xp from training approvals and logged games is doubled this week.", color:"#B8FF4D" },
  { id:"double_points", emoji:"💰", title:"Double Points Week", desc:"all points earned from logged games and approved training are doubled this week.", color:"#FFD166" },
  { id:"no_betting", emoji:"🚫", title:"No Betting Week", desc:"the boost tab's wheel, slots, props, and parlays are paused this week. focus up.", color:"#FF5C8A" },
  { id:"heat_surge", emoji:"⚡", title:"Heat Streak Surge", desc:"heat streak multipliers are boosted this week — win streaks hit harder.", color:"#FF8C32" },
  { id:"assist_week", emoji:"🎯", title:"Assist Week", desc:"games with 2+ assists earn bonus pass xp this week.", color:"#A78BFA" },
  { id:"save_week", emoji:"🧤", title:"Save Week", desc:"games with 3+ saves earn bonus pass xp this week.", color:"#4D9EFF" },
];

// ===================== Team Chemistry =====================
const CHEMISTRY_PAIRS = [
  ["p1","p2"], ["p1","p3"], ["p2","p3"]
];

function getChemistryKey(a, b) {
  return [a,b].sort().join("_");
}

function getChemistryLevel(xp) {
  if (xp >= 500) return { level:5, label:"Legendary", color:"#FFD166", emoji:"👑" };
  if (xp >= 300) return { level:4, label:"Elite",     color:"#FF61C1", emoji:"💎" };
  if (xp >= 150) return { level:3, label:"Solid",     color:"#A78BFA", emoji:"⚡" };
  if (xp >= 60)  return { level:2, label:"Building",  color:"#4D9EFF", emoji:"🤝" };
  if (xp >= 10)  return { level:1, label:"Fresh",     color:"#B8FF4D", emoji:"🌱" };
  return           { level:0, label:"None",     color:"#4A5066", emoji:"💤" };
}

function getChemistryBonus(xp) {
  const lvl = getChemistryLevel(xp).level;
  return {
    xpBonus:     [0, 0.05, 0.10, 0.15, 0.25, 0.40][lvl],
    oddsBonus:   [0, 0.02, 0.05, 0.08, 0.12, 0.20][lvl],
  };
}

// ===================== Duo Badges =====================
const DUO_BADGE_DEFS = [
  { id:"first_win",     label:"First Blood",     emoji:"🩸", desc:"won your first game together",        check:(d)=>d.totalWins>=1 },
  { id:"win_streak_3",  label:"Hot Streak",       emoji:"🔥", desc:"won 3 games in a row together",       check:(d)=>d.bestStreak>=3 },
  { id:"win_streak_5",  label:"On Fire",          emoji:"🌋", desc:"won 5 games in a row together",       check:(d)=>d.bestStreak>=5 },
  { id:"win_streak_10", label:"Unbeatable",       emoji:"☄️", desc:"won 10 games in a row together",      check:(d)=>d.bestStreak>=10 },
  { id:"wins_10",       label:"Dynamic Duo",      emoji:"🏆", desc:"10 wins together",                    check:(d)=>d.totalWins>=10 },
  { id:"wins_25",       label:"Battle Tested",    emoji:"🛡️", desc:"25 wins together",                   check:(d)=>d.totalWins>=25 },
  { id:"wins_50",       label:"Legends",          emoji:"👑", desc:"50 wins together",                    check:(d)=>d.totalWins>=50 },
  { id:"grinders_20",   label:"Grinders",         emoji:"⚡", desc:"20 games played together",            check:(d)=>d.totalGames>=20 },
  { id:"grinders_50",   label:"Iron Bond",        emoji:"⚙️", desc:"50 games played together",            check:(d)=>d.totalGames>=50 },
  { id:"max_chem",       label:"Soulmates",        emoji:"💞", desc:"reached max chemistry level",         check:(d)=>d.chemLevel>=5 },
];

function getDuoBadgeStats(sharedGames) {
  const totalGames = sharedGames.length;
  const totalWins = sharedGames.filter(g => gameIsWin(g.p1game)).length;
  let bestStreak = 0, curStreak = 0;
  // chronological order
  const sorted = [...sharedGames].sort((a,b) => new Date(a.p1game.ts) - new Date(b.p1game.ts));
  sorted.forEach(g => {
    if (gameIsWin(g.p1game)) { curStreak++; bestStreak = Math.max(bestStreak, curStreak); }
    else curStreak = 0;
  });
  return { totalGames, totalWins, bestStreak };
}

function getEarnedDuoBadges(sharedGames, chemLevel) {
  const stat = getDuoBadgeStats(sharedGames);
  const data = { ...stat, chemLevel };
  return DUO_BADGE_DEFS.filter(b => b.check(data));
}


const FORCED_EVENT_ID = "double_xp"; // set to null to go back to random weekly rotation

function getWeeklyEvent() {
  const weekNum = Math.floor(Date.now() / WEEK_MS);
  if (FORCED_EVENT_ID) {
    const forced = WEEKLY_EVENTS.find(e => e.id === FORCED_EVENT_ID);
    if (forced) return { ...forced, weekNum };
  }
  // Deterministic seeded pick so every player sees the same event this week.
  let h = weekNum * 2654435761;
  h = (h ^ (h >>> 13)) % 100000;
  const idx = Math.abs(h) % WEEKLY_EVENTS.length;
  return { ...WEEKLY_EVENTS[idx], weekNum };
}
function isEventActive(eventId) {
  return getWeeklyEvent().id === eventId;
}

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

function gameIsWin(game) {
  if (game?.result) return ["victory", "win", "won"].includes(String(game.result).toLowerCase());
  const our = Number(game?.ourScore);
  const their = Number(game?.theirScore);
  return Number.isFinite(our) && Number.isFinite(their) && our > their;
}
function formatGameScore(game) {
  const ourRaw = game?.ourScore ?? game?.goals ?? 0;
  const our = Number.isFinite(Number(ourRaw)) ? Number(ourRaw) : 0;
  const theirRaw = game?.theirScore;
  const theirKnown = theirRaw !== null && theirRaw !== undefined && theirRaw !== "" && Number.isFinite(Number(theirRaw));
  return `${our} – ${theirKnown ? Number(theirRaw) : "?"}`;
}
function applySyncedTeamScores(importedGames, result) {
  const ourScore = importedGames.reduce((sum, g) => sum + (Number(g.goals) || 0), 0);
  return importedGames.map(g => ({
    ...g,
    ourScore,
    theirScore: g.theirScore === null || g.theirScore === undefined || g.theirScore === "" ? null : Number(g.theirScore),
    opponentScoreManual: g.opponentScoreManual || false,
    result,
  }));
}

// ===================== MMR helpers =====================
const RL_PLAYLISTS = ["Ranked Duel 1v1","Ranked Doubles 2v2","Ranked Standard 3v3"];
function deterministicMMR(seed, idx) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 700 + (h % 900) + idx * 60;
}


function rlRankFromTierValue(tierValue) {
  const ranks = [
    "Unranked",
    "Bronze I", "Bronze II", "Bronze III",
    "Silver I", "Silver II", "Silver III",
    "Gold I", "Gold II", "Gold III",
    "Platinum I", "Platinum II", "Platinum III",
    "Diamond I", "Diamond II", "Diamond III",
    "Champion I", "Champion II", "Champion III",
    "Grand Champion I", "Grand Champion II", "Grand Champion III",
    "Supersonic Legend"
  ];

  return ranks[tierValue] || "Unranked";
}


function getRankImage(rankName) {
  if (!rankName) return null;

  const r = rankName.toLowerCase();

  if (r.includes("supersonic")) return "/ranks/Supersonic Legend.png";

  if (r.includes("grand champion iii")) return "/ranks/Grand Champion III.png";
  if (r.includes("grand champion ii")) return "/ranks/Grand Champion II.png";
  if (r.includes("grand champion")) return "/ranks/Grand Champion I.png";

  if (r.includes("champion iii")) return "/ranks/Champion III.png";
  if (r.includes("champion ii")) return "/ranks/Champion II.png";
  if (r.includes("champion")) return "/ranks/Champion I.png";

  if (r.includes("diamond iii")) return "/ranks/Diamond III.png";
  if (r.includes("diamond ii")) return "/ranks/Diamond II.png";
  if (r.includes("diamond")) return "/ranks/Diamond I.png";

  if (r.includes("platinum iii")) return "/ranks/Platinum III.png";
  if (r.includes("platinum ii")) return "/ranks/Platinum II.png";
  if (r.includes("platinum")) return "/ranks/Platinum I.png";

  if (r.includes("gold iii")) return "/ranks/Gold III.png";
  if (r.includes("gold ii")) return "/ranks/Gold II.png";
  if (r.includes("gold")) return "/ranks/Gold I.png";

  if (r.includes("silver iii")) return "/ranks/Silver III.png";
  if (r.includes("silver ii")) return "/ranks/Silver II.png";
  if (r.includes("silver")) return "/ranks/Silver I.png";

  if (r.includes("bronze iii")) return "/ranks/Bronze III.png";
  if (r.includes("bronze ii")) return "/ranks/Bronze II.png";
  if (r.includes("bronze")) return "/ranks/Bronze I.png";

  if (r.includes("unranked")) return "/ranks/Unranked.png";

  return null;
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
function SyncOverlay({ label }) {
  return (
    <div style={s.syncOverlay}>
      <div style={s.syncBox}>
        <div style={s.syncSpinner} />
        <div style={s.syncTitle}>{label || "fetching from tracker…"}</div>
        <div style={{ fontSize:11, color:"#4A5066", marginTop:8 }}>usually takes 1–5 seconds</div>
      </div>
    </div>
  );
}


// ===================== Swipe helpers =====================
function useSwipeRightToClose(onClose, threshold = 105) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeStartTime = useRef(0);
  const isSwiping = useRef(false);

  const getScreenWidth = () => {
    if (typeof window === "undefined") return 390;
    return Math.max(window.innerWidth || 390, 320);
  };

  const handleTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t || isClosing) return;
    swipeStartX.current = t.clientX;
    swipeStartY.current = t.clientY;
    swipeStartTime.current = Date.now();
    isSwiping.current = false;
  };

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t || isClosing) return;
    const dx = t.clientX - swipeStartX.current;
    const dy = Math.abs(t.clientY - swipeStartY.current);

    if (dx > 10 && dx > dy * 1.15) {
      isSwiping.current = true;
      if (e.cancelable) e.preventDefault();
      const width = getScreenWidth();
      const softened = dx < width ? dx : width + (dx - width) * 0.15;
      setSwipeOffset(Math.max(0, Math.min(softened, width * 1.08)));
    }
  };

  const handleTouchEnd = () => {
    if (isClosing) return;
    const elapsed = Math.max(Date.now() - swipeStartTime.current, 1);
    const velocity = swipeOffset / elapsed;
    const shouldClose = isSwiping.current && (swipeOffset > threshold || velocity > 0.72);

    if (shouldClose) {
      const width = getScreenWidth();
      setIsClosing(true);
      setSwipeOffset(width);
      setTimeout(() => {
        onClose?.();
        setSwipeOffset(0);
        setIsClosing(false);
      }, 210);
      return;
    }

    setSwipeOffset(0);
    isSwiping.current = false;
  };

  const width = getScreenWidth();
  const progress = Math.min(swipeOffset / width, 1);

  return {
    swipeHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
    swipeStyle: {
      transform: `translate3d(${swipeOffset}px, 0, 0) scale(${1 - progress * 0.025})`,
      opacity: 1 - progress * 0.22,
      borderTopLeftRadius: progress ? 22 * progress : 0,
      borderBottomLeftRadius: progress ? 22 * progress : 0,
      boxShadow: progress ? `-18px 0 44px rgba(0,0,0,${0.18 * progress})` : undefined,
      transition: isClosing
        ? "transform .2s cubic-bezier(.22,1,.36,1), opacity .2s ease, border-radius .2s ease"
        : swipeOffset === 0
          ? "transform .34s cubic-bezier(.22,1,.36,1), opacity .24s ease, border-radius .24s ease"
          : "none",
      willChange: "transform, opacity",
      touchAction: isSwiping.current ? "none" : "pan-y",
    },
  };
}


function EmptyState({ icon = "○", title, body, actionLabel, onAction }) {
  return (
    <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:18,padding:"18px 16px",textAlign:"center",marginBottom:14,boxShadow:"0 12px 28px rgba(0,0,0,0.18)"}}>
      <div style={{fontSize:28,marginBottom:8,opacity:.9}}>{icon}</div>
      <div style={{fontSize:14,fontWeight:900,color:"#E8ECF4",marginBottom:5,letterSpacing:.2}}>{title}</div>
      {body && <div style={{fontSize:11.5,color:"#8B92A8",lineHeight:1.45,maxWidth:280,margin:"0 auto"}}>{body}</div>}
      {actionLabel && onAction && (
        <button onClick={onAction} className="bb-pressable bb-glow-lime" style={{marginTop:14,background:"#B8FF4D",border:"none",borderRadius:12,padding:"9px 13px",fontSize:11,fontWeight:900,color:"#06070D",cursor:"pointer"}}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function FullScreenHeader({ title, subtitle, onClose, accent = "#B8FF4D" }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"16px 18px",paddingTop:"calc(env(safe-area-inset-top) + 14px)",borderBottom:"1px solid rgba(255,255,255,0.07)",background:"rgba(4,8,24,0.92)",backdropFilter:"blur(14px)",flexShrink:0}}>
      <button onClick={onClose} className="bb-pressable" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,color:"#8B92A8",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",width:38,height:38}}>
        <ChevronLeft size={18}/>
      </button>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,textTransform:"lowercase",color:"#E8ECF4",letterSpacing:.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
        {subtitle && <div style={{fontSize:10.5,color:accent,fontWeight:800,letterSpacing:.8,marginTop:2,textTransform:"uppercase"}}>{subtitle}</div>}
      </div>
      <div style={{fontSize:10,color:"#4A5066",fontWeight:800,letterSpacing:.7,textTransform:"uppercase"}}>swipe →</div>
    </div>
  );
}

function HomeCommandCenter({ currentPlayer, points, nextMatch, daysUntil, previewDays, completions, stats, onGotoTraining, onGotoStats, onOpenBracket }) {
  const today = todayAtMidnight();
  const todayKey = dateKey(today);
  const todayItem = previewDays.find(d => d.key === todayKey) || previewDays[0];
  const todayCompletion = completions?.[tKey(todayItem?.key || todayKey, currentPlayer)];
  const playerGames = (stats || []).filter(g => g.playerId === currentPlayer).sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  const latestGame = playerGames[0];
  const myPoints = points?.[currentPlayer] || 0;
  const trainingStatus = todayCompletion?.status === "approved" ? "approved" : todayCompletion?.status === "pending" ? "pending" : todayItem?.training ? "open" : "not set";
  const resultColor = latestGame ? (latestGame.ourScore > latestGame.theirScore ? "#7CFFB2" : "#FF5C8A") : "#4A5066";
  const miniCard = (label, value, sub, accent, onClick) => (
    <button onClick={onClick} className="bb-pressable" style={{background:"rgba(255,255,255,0.045)",border:`1px solid ${accent}26`,borderRadius:16,padding:"13px 12px",textAlign:"left",cursor:onClick?"pointer":"default",minHeight:88}}>
      <div style={{fontSize:9.5,color:accent,fontWeight:900,letterSpacing:.8,textTransform:"uppercase",marginBottom:7}}>{label}</div>
      <div style={{fontSize:17,fontWeight:900,color:"#E8ECF4",lineHeight:1.05,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</div>
      <div style={{fontSize:10.5,color:"#8B92A8",lineHeight:1.35,marginTop:6}}>{sub}</div>
    </button>
  );

  return (
    <div style={{background:"linear-gradient(135deg,#121626,#090B14)",border:"1px solid rgba(184,255,77,0.14)",borderRadius:22,padding:16,marginBottom:16,boxShadow:"0 18px 42px rgba(0,0,0,0.28)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:14}}>
        <div>
          <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",marginBottom:4}}>today's command center</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,fontWeight:700,color:"#E8ECF4",lineHeight:1}}>what matters now</div>
        </div>
        <div style={{fontSize:10,color:"#4A5066",fontWeight:800,textTransform:"uppercase",paddingTop:4}}>{fmtRelTime(new Date().toISOString())}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {miniCard("training", todayItem?.training?.title || "not assigned", trainingStatus, "#A78BFA", onGotoTraining)}
        {miniCard("latest game", latestGame ? `${latestGame.ourScore}-${latestGame.theirScore}` : "no games", latestGame ? `${latestGame.mode} · ${fmtRelTime(latestGame.ts)}` : "sync after your next match", resultColor, latestGame ? onGotoStats : onGotoStats)}
        {miniCard("next match", nextMatch ? (nextMatch.opponent || "TBD") : "season done", nextMatch ? `${nextMatch.label} · ${daysUntil===0?"this week":`in ${daysUntil}d`}` : "no upcoming match", "#B8FF4D", onOpenBracket)}
        {miniCard("balance", `${myPoints} pts`, "shop · bets · rewards", "#FFD166", null)}
      </div>
    </div>
  );
}

function RecentActivityFeed({ stats, completions, trainingData, currentPlayer, onGotoStats, onGotoTraining }) {
  const statItems = (stats || []).slice().sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,6).map(g => {
    const p = PLAYERS.find(pl => pl.id === g.playerId);
    const won = gameIsWin(g);
    const mmr = g.ratingDelta != null ? ` · ${g.ratingDelta > 0 ? "+" : ""}${g.ratingDelta} MMR` : "";
    return { id:`game-${g.id || g.ts}-${g.playerId}`, ts:g.ts, icon:won?"✓":"×", color:won?"#7CFFB2":"#FF5C8A", title:`${p?.name || "player"} ${won?"won":"lost"} ${g.mode || "game"}`, sub:`${formatGameScore(g)}${mmr}`, action:onGotoStats };
  });
  const trainingItems = Object.entries(completions || {}).filter(([k,v])=>k.endsWith(`__${currentPlayer}`)&&v?.submittedAt).map(([k,v])=>{
    const dk = k.split("__")[0];
    const tr = trainingData?.[tKey(dk,currentPlayer)];
    return { id:`train-${k}`, ts:v.submittedAt, icon:v.status==="approved"?"✓":v.status==="rejected"?"!":"↑", color:v.status==="approved"?"#7CFFB2":v.status==="rejected"?"#FF5C8A":"#A78BFA", title:`training ${v.status || "submitted"}`, sub:tr?.title || fmtDay(new Date(dk+"T00:00:00")), action:onGotoTraining };
  }).slice(0,5);
  const items = [...statItems, ...trainingItems].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,5);

  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:12,color:"#4A5066",fontWeight:900,letterSpacing:1,textTransform:"uppercase"}}>recent activity</div>
        <div style={{fontSize:10,color:"#4A5066",fontWeight:800}}>latest 5</div>
      </div>
      {!items.length ? (
        <EmptyState icon="⌁" title="Nothing new yet" body="Sync a game, submit training, or claim a reward and it will show here." />
      ) : (
        <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:18,padding:10,boxShadow:"0 12px 28px rgba(0,0,0,0.18)"}}>
          {items.map((item, idx)=>(
            <button key={item.id} onClick={item.action} className="bb-pressable" style={{width:"100%",background:idx?"transparent":"rgba(255,255,255,0.035)",border:"none",borderRadius:13,padding:"10px 9px",display:"flex",alignItems:"center",gap:10,textAlign:"left",cursor:"pointer"}}>
              <div style={{width:28,height:28,borderRadius:10,background:`${item.color}18`,color:item.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,flexShrink:0}}>{item.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,color:"#E8ECF4",fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.title}</div>
                <div style={{fontSize:10.5,color:"#8B92A8",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.sub} · {fmtRelTime(item.ts)}</div>
              </div>
              <ChevronRight size={14} color="#4A5066" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== Global CSS =====================

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Inter:wght@400;600;700&display=swap');
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes coinFlipReal { 0%{ transform:translate3d(0,0,0) rotateX(0deg) rotateZ(-4deg); } 18%{ transform:translate3d(0,-16px,0) rotateX(360deg) rotateZ(4deg); } 40%{ transform:translate3d(0,-27px,0) rotateX(720deg) rotateZ(-3deg); } 62%{ transform:translate3d(0,-20px,0) rotateX(1080deg) rotateZ(3deg); } 82%{ transform:translate3d(0,-8px,0) rotateX(1440deg) rotateZ(-2deg); } 100%{ transform:translate3d(0,0,0) rotateX(1800deg) rotateZ(0deg); } }
      @keyframes coinShine { 0%,100%{ opacity:.16; transform:translateX(-45%) rotate(18deg); } 50%{ opacity:.34; transform:translateX(45%) rotate(18deg); } }
      @keyframes fadeSlideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
@keyframes dropDown { from { transform:translateY(-100%); opacity:0; } to { transform:translateY(0); opacity:1; } }
      @keyframes chatSlideIn { from { transform:translateY(18px); opacity:.88; } to { transform:translateY(0); opacity:1; } }
      @keyframes chatFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes chatPanelIn { from { opacity:0; transform:translateY(14px) scale(.995); } to { opacity:1; transform:translateY(0) scale(1); } }
      @keyframes chatPanelUp { from { transform:translateY(32px); } to { transform:translateY(0); } }
      @keyframes softCardIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes modalSheetUp { from { transform:translateY(18px); opacity:.92; } to { transform:translateY(0); opacity:1; } }
      @keyframes heartPop { 0%{transform:scale(1)} 40%{transform:scale(1.35)} 100%{transform:scale(1)} }
   @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes bounceDot { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
@keyframes scaleFadeIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
@keyframes floatUp { 0%{transform:translateY(0) scale(0.5); opacity:0;} 15%{opacity:1;} 100%{transform:translateY(-180px) scale(1.1); opacity:0;} }
@keyframes dropUp { from { transform:translateY(100%); opacity:0; } to { transform:translateY(0); opacity:1; } }
    * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
    html, body { margin:0; padding:0; width:100%; height:100dvh; min-height:100dvh; overflow:hidden; background:#06070D; overscroll-behavior:none; }
#root { width:100%; height:100dvh; min-height:100dvh; background:#06070D; overflow:hidden; }
@supports (-webkit-touch-callout: none) { html, body, #root { min-height:100dvh; } }
      input::placeholder, textarea::placeholder { color:#4A5066; }
      input,textarea,button { font-family:inherit; }
      ::-webkit-scrollbar { width:0; background:transparent; }
      * { scrollbar-width:none; -ms-overflow-style:none; }

      button, .bb-pressable { transition:transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-color .22s ease, background .22s ease, opacity .18s ease; outline:none; -webkit-tap-highlight-color:transparent; }
      button:active, .bb-pressable:active { transform:scale(0.975); }
      button:disabled { opacity:.55; cursor:not-allowed; }
      .bb-card-polish { box-shadow:0 12px 28px rgba(0,0,0,.18); }
      @media (hover:hover) {
        .bb-pressable:hover { transform:translateY(-1px); }
        .bb-glow-lime:hover { box-shadow:0 0 0 1px rgba(184,255,77,.4),0 8px 24px rgba(184,255,77,.12); border-color:rgba(184,255,77,.4) !important; }
        .bb-glow-violet:hover { box-shadow:0 0 0 1px rgba(167,139,250,.4),0 8px 24px rgba(167,139,250,.12); border-color:rgba(167,139,250,.4) !important; }
        .bb-glow-pink:hover { box-shadow:0 0 0 1px rgba(255,92,138,.4),0 8px 24px rgba(255,92,138,.12); border-color:rgba(255,92,138,.4) !important; }
      }
      .bb-tab-content { animation:fadeSlideUp .24s cubic-bezier(.2,.8,.2,1); }
      .bb-tab-content > * { animation:softCardIn .22s cubic-bezier(.2,.8,.2,1); }
      .bb-heart-pop { animation:heartPop .32s ease; }
      .bb-live-dot { animation:livePulse 1.4s ease-in-out infinite; }
      .bb-tab-content { color: var(--bb-main-text, #E8ECF4); }
      .bb-tab-content [style*="#4A5066"] { color: var(--bb-muted-text, #4A5066) !important; }
      .bb-tab-content [style*="#B8FF4D"] { color: var(--bb-accent-text, #B8FF4D) !important; }
    `}</style>
  );
}

// ===================== Auth screens =====================
function NameSelectScreen({ onSelect }) {
  return (
    <div style={{...s.loginScreen, animation:"fadeSlideUp .5s cubic-bezier(.2,.8,.2,1)"}}>
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
   <div style={{...s.loginScreen, animation:"fadeSlideUp .5s cubic-bezier(.2,.8,.2,1)"}}><div style={s.loginGlow} /><div style={s.loginContent}>
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
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const cachedAuth = useRef(null);

  useEffect(() => {
    storeGet(`auth:${player.id}`).then(a => { cachedAuth.current = a; });
  }, [player.id]);

  const submit = (finalCode) => {
    if (cachedAuth.current?.passcode === finalCode) onSuccess();
    else {
      setShaking(true);
      setError("Wrong passcode.");
      setCode("");
      setTimeout(() => setShaking(false), 500);
    }
  };

  const pressNum = (num) => {
    if (code.length >= 4) return;
    const next = code + num;
    setCode(next);
    setError("");
    if (next.length === 4) setTimeout(() => submit(next), 80);
  };

  const pressDelete = () => setCode(c => c.slice(0, -1));

  const NUMS = [["1","2","3"],["4","5","6"],["7","8","9"],["","0","⌫"]];

  return (
    <div style={s.loginScreen}>
      <div style={s.loginGlow} />
      <div style={s.loginContent}>
        <button onClick={onBack} className="bb-pressable" style={s.backBtn}><ChevronLeft size={16}/> back</button>
        <div style={{ ...s.loginPlayerDot, background:player.color, margin:"0 auto 18px", width:14, height:14 }} />
        <div style={s.loginTitle}>{player.name}</div>
        <div style={s.loginSub}>enter your passcode</div>
        <div style={{display:"flex",justifyContent:"center",gap:16,marginBottom:32,marginTop:8}}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{width:14,height:14,borderRadius:"50%",background:code.length>i?player.color:"rgba(255,255,255,0.15)",transition:"background .15s ease",boxShadow:code.length>i?`0 0 8px ${player.color}99`:""}}/>
          ))}
        </div>
        {error && <div style={{...s.loginError,marginBottom:16,textAlign:"center"}}>{error}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {NUMS.map((row, ri) => (
            <div key={ri} style={{display:"flex",justifyContent:"center",gap:20}}>
              {row.map((num, ci) => (
                num === "" ? <div key={ci} style={{width:72,height:72}}/> :
                <button key={ci} onClick={() => { num==="⌫" ? pressDelete() : pressNum(num); }}
                  className="bb-pressable"
                  style={{width:72,height:72,borderRadius:"50%",background:num==="⌫"?"none":"rgba(255,255,255,0.08)",border:num==="⌫"?"none":"1px solid rgba(255,255,255,0.1)",color:"#E8ECF4",fontSize:num==="⌫"?22:24,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {num}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrackerSetup({ player, onComplete, onUseCredit }) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const finishSync = async () => {
    if (onUseCredit) {
      const ok = await onUseCredit();
      if (!ok) { setError("out of parse credits — ask the captain for more"); return; }
    }
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(
       `https://api.parse.bot/scraper/d0dcf8e8-3a72-4b21-bffb-8fa735257835/get_player_profile?platform=${player.platform}&username=${player.name}`,
        { headers: { "X-API-Key": "pmx_8a6e026a59120911628f4faf9ff66847" } }
      );
      const json = await res.json();
      const segments = json?.data?.segments || [];
      const playlistIds = { "Ranked Duel 1v1": 10, "Ranked Doubles 2v2": 11, "Ranked Standard 3v3": 13 };
      const ranks = RL_PLAYLISTS.map(name => {
     const seg = segments.find(s => s.type === "playlist" && s.metadata?.name === name);
const mmr = seg?.stats?.rating?.value || 0;

console.log("MMR SEGMENT:", name, seg?.stats);

const newRankName = rlRankFromTierValue(seg?.stats?.tier?.value);

return { playlist: name, mmr, rank: newRankName };
});

console.log("FINAL RANKS BEING SAVED:", ranks);

await setMMR(player.id, { platform: player.platform, handle: player.name, ranks, lastSynced: new Date().toISOString(), source: "synced" });
      setSyncing(false);
      onComplete();
    } catch (e) {
      setError("failed to fetch — check connection");
      setSyncing(false);
    }
  };

  return (
    <div style={s.screen}>
      <div style={s.setupWrap}>
        <div style={s.setupTitle}>link your rocket league account</div>
        <div style={s.setupSub}>pulls your real ranks from tracker.gg</div>
        <div style={{ marginBottom: 16, background: "#11131F", borderRadius: 14, padding: 14, border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 11, color: "#4A5066", marginBottom: 4 }}>platform</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#B8FF4D" }}>{player.platform.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: "#4A5066", marginTop: 8, marginBottom: 4 }}>username</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>{player.name}</div>
        </div>
        {error && <div style={{ color: "#FF5C8A", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <button onClick={finishSync} disabled={syncing} className="bb-pressable bb-glow-lime" style={{ ...s.primaryBtn, opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "fetching from tracker…" : "sync my ranks"}
        </button>
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
    {getRankImage(r.rank) && (
      <img src={getRankImage(r.rank)} alt={r.rank} style={{width:36,height:36,objectFit:"contain",margin:"4px auto",display:"block"}}/>
    )}

{console.log("Rank:", r.rank, "Image:", getRankImage(r.rank))}

<div style={{ ...s.mmrRank, color: accent }}>
  {r.rank}
</div>

{r.division && (
  <div
    style={{
      fontSize: 11,
      color: "#7A839C",
      marginTop: 2,
    }}
  >
    {r.division}
  </div>
)}

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
const CHALLENGE_FIELDS = ["goals","assists","saves","shots"];

const ALL_CHALLENGES = [
  // 3v3
  { mode:"3v3", type:"avg", field:"goals",   target:2.5, desc:(t,r)=>`average ${t} goals/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"assists",  target:2.0, desc:(t,r)=>`average ${t} assists/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"saves",    target:3.0, desc:(t,r)=>`average ${t} saves/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"demos",    target:2.0, desc:(t,r)=>`average ${t} demos/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"avg", field:"shots",    target:3.5, desc:(t,r)=>`average ${t} shots/game in 3v3 to beat ${r}'s average`, color:"#B8FF4D" },
  { mode:"3v3", type:"cumulative", field:"saves", target:12, desc:(t)=>`rack up ${t} total saves across your 3v3 games this week`, color:"#B8FF4D" },
  // 2v2
  { mode:"2v2", type:"cumulative", field:"assists", target:10, desc:(t)=>`get ${t} total assists across your 2v2 games this week`, color:"#FF61C1" },
  { mode:"2v2", type:"cumulative", field:"saves",   target:15, desc:(t)=>`rack up ${t} saves in 2v2 this week`, color:"#FF61C1" },
  { mode:"2v2", type:"avg",        field:"goals",   target:2.0, desc:(t)=>`average ${t}+ assists per game in 2v2 this week`, color:"#FF61C1" },
  { mode:"2v2", type:"winrate",    field:null,      target:0.6, desc:()=>`win more than 60% of your 2v2 games this week`, color:"#FF61C1" },
  { mode:"2v2", type:"cumulative", field:"demos",   target:8,  desc:(t)=>`land ${t} demos in 2v2 this week`, color:"#FF61C1" },
  { mode:"2v2", type:"avg",        field:"shots",   target:3.0, desc:(t)=>`average ${t}+ shots per game in 2v2 this week`, color:"#FF61C1" },
  // 1v1
  { mode:"1v1", type:"streak",     field:null,      target:3,  desc:()=>`win 3 in a row in 1v1`, color:"#4D9EFF" },
  { mode:"1v1", type:"avg",        field:"goals",   target:3.0, desc:(t)=>`average ${t}+ goals per game in 1v1 this week`, color:"#4D9EFF" },
  { mode:"1v1", type:"cumulative", field:"shots",   target:20, desc:(t)=>`take ${t} total shots in 1v1 this week`, color:"#4D9EFF" },
  { mode:"1v1", type:"avg",        field:"saves",   target:2.0, desc:(t)=>`average ${t}+ saves per game in 1v1`, color:"#4D9EFF" },
  { mode:"1v1", type:"streak",     field:null,      target:3,  desc:()=>`score 2 goals in 3 consecutive 1v1 games`, color:"#4D9EFF" },
  { mode:"1v1", type:"cumulative", field:"assists", target:5,  desc:(t)=>`get ${t} total saves in 1v1 this week`, color:"#4D9EFF" },
];
function getWeekStart() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

            function getSessionGroups(stats) {
  const groups = {};
  stats.forEach(g => {
    if (!g.sessionCode) return;
    if (g.mode !== "2v2" && g.mode !== "3v3") return;
    const key = `${g.sessionCode}__${g.mode}`;
    if (!groups[key]) groups[key] = { code: g.sessionCode, mode: g.mode, games: [], ts: g.ts };
    groups[key].games.push(g);
    if (new Date(g.ts) > new Date(groups[key].ts)) groups[key].ts = g.ts;
  });
  return Object.values(groups).sort((a,b) => new Date(b.ts) - new Date(a.ts));
}
            
function SessionGroupCard({ session, allStats, gameLabel, onUpdateOpponentScore }) {
  const [open, setOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const rep = session.games[0];
  const won = gameIsWin(rep);
  const duoIds = [...new Set(session.games.flatMap(g => g.duoIds || [g.playerId]).filter(Boolean))];
  const duoLabel = session.mode === "2v2"
    ? duoIds.map(id => PLAYERS.find(p => p.id === id)?.name).filter(Boolean).join(" + ")
    : null;

  return (
    <div style={{background:"#11131F",borderRadius:14,marginBottom:10,border:`1px solid ${won?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`}}>
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          allPlayerGames={(allStats||[]).filter(g=>g.playerId===selectedGame.playerId&&g.mode===selectedGame.mode).sort((a,b)=>new Date(a.ts)-new Date(b.ts))}
          onClose={()=>setSelectedGame(null)}
          onUpdateOpponentScore={onUpdateOpponentScore}
        />
      )}
      {/* Clickable header */}
      <button onClick={()=>setOpen(v=>!v)} className="bb-pressable" style={{width:"100%",background:"none",border:"none",padding:"14px 16px",cursor:"pointer",textAlign:"left"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:10,color:"#A78BFA",fontWeight:700,letterSpacing:0.8}}>{gameLabel || "GAME"}</div>
            <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{session.mode} · {duoLabel ? `${duoLabel} · ` : ""}{fmtRelTime(session.ts)} · {session.games.length} player{session.games.length!==1?"s":""} logged</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A"}}>{won?"WIN":"LOSS"}</div>
            </div>
            <ChevronRight size={14} color="#4A5066" style={{transform:open?"rotate(90deg)":"none",transition:"transform .2s",flexShrink:0}}/>
          </div>
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{padding:"0 16px 14px",display:"flex",flexDirection:"column",gap:6}}>
          {session.games.map(g => {
            const p = PLAYERS.find(pl => pl.id === g.playerId);
            return (
              <button key={g.id} onClick={()=>setSelectedGame(g)} className="bb-pressable"
                style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px 10px",display:"flex",alignItems:"center",gap:10,border:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",textAlign:"left",width:"100%"}}>
                <div style={{width:7,height:7,borderRadius:99,background:p?.color,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:700,color:p?.color,minWidth:64}}>{p?.name}</span>

<div style={{
  fontSize:11,
  fontWeight:700,
  color:g.ratingDelta >= 0 ? "#7CFFB2" : "#FF5C8A"
}}>
  {g.ratingDelta != null ? `${g.ratingDelta > 0 ? "+" : ""}${g.ratingDelta} MMR` : "—"}
</div>
                <div style={{display:"flex",gap:10,marginLeft:"auto"}}>
                  {["goals","assists","saves","shots","demos"].map(f => (
                    <div key={f} style={{textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#4A5066",fontWeight:700,textTransform:"uppercase"}}>{f.slice(0,3)}</div>
                      <div style={{fontSize:12,fontWeight:700,color:p?.color||"#E8ECF4"}}>{g[f]||0}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:9,color:"#4A5066",flexShrink:0}}>→</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
    const wins = games.filter(g => gameIsWin(g)).length;
    const rate = games.length ? wins/games.length : 0;
    return { current: rate, target: challenge.target, done: rate >= challenge.target, display: `${Math.round(rate*100)}%` };
  }
  if (challenge.type === "streak") {
    const sorted = [...games].sort((a,b) => new Date(a.ts)-new Date(b.ts));
    let streak = 0;
    for (let i = sorted.length-1; i >= 0; i--) {
      if (gameIsWin(sorted[i])) streak++;
      else break;
    }
    return { current: streak, target: challenge.target, done: streak >= challenge.target, display: streak };
  }
  return { current: 0, target: challenge.target, done: false, display: 0 };
}

function ChallengeCompactRow({ challenge, mode, idxInMode, stats, currentPlayer, rival, completions, onClaim }) {
  const rivalGames = stats.filter(g => g.playerId === rival.id && g.mode === "3v3");
  const rivalAvg = mode === "3v3" && challenge.field && rivalGames.length
    ? (rivalGames.reduce((s,g) => s+(g[challenge.field]||0),0)/rivalGames.length).toFixed(1)
    : null;
  const adjustedTarget = mode === "3v3" && challenge.type === "avg" && rivalAvg
    ? Math.max(Number(rivalAvg)+0.1, challenge.target)
    : challenge.target;
  const progress = getChallengeProgress({...challenge, target: adjustedTarget}, stats, currentPlayer);
  const claimKey = `challenge_${currentPlayer}_${Math.floor(Date.now()/WEEK_MS)}_${mode}_${idxInMode}`;
  const claimed = !!completions[claimKey];
  const grantsBonusSpin = idxInMode === 0 || idxInMode === 3;
const grantsPassTier = idxInMode === 0 || idxInMode === 2; // 1st and 3rd challenge per mode grant a pass tier
  const color = challenge.color;
  const progressPct = Math.min(1, progress.current / adjustedTarget);
  const descText = mode === "3v3" && rivalAvg
    ? challenge.desc(adjustedTarget.toFixed(1), rival.name)
    : challenge.desc(adjustedTarget);
  const modeLabel = `${{ "3v3":"3V3","2v2":"2V2","1v1":"1V1" }[mode]}${idxInMode>0?` #${idxInMode+1}`:""}`;

  return (
    <div style={{background:"#161927",borderRadius:11,padding:"10px 12px",marginBottom:6,border:`1px solid ${color}1a`}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
        <div style={{fontSize:9,color,fontWeight:700,letterSpacing:0.5}}>{modeLabel}</div>
        {grantsBonusSpin && <div style={{fontSize:8,color:"#FFD166",fontWeight:700}}>🎡</div>}
        <div style={{fontSize:10.5,color:"#8B92A8",marginLeft:"auto"}}>{progress.display} / {challenge.type==="winrate"?"60%":adjustedTarget}</div>
      </div>
      <div style={{fontSize:11.5,color:"#E8ECF4",lineHeight:1.35,marginBottom:6}}>{descText}</div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1,height:5,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${progressPct*100}%`,background:progress.done?"#7CFFB2":color,borderRadius:99,transition:"width .3s ease"}}/>
        </div>
        {claimed ? (
          <span style={{fontSize:10,color:"#7CFFB2",fontWeight:700,flexShrink:0}}>✓ claimed</span>
        ) : progress.done ? (
          <button onClick={()=>onClaim(claimKey, grantsBonusSpin, idxInMode===0||idxInMode===2)} className="bb-pressable bb-glow-lime"
            style={{flexShrink:0,background:color,border:"none",borderRadius:7,padding:"4px 9px",fontSize:9.5,fontWeight:700,color:"#06070D",cursor:"pointer"}}>
            claim
          </button>
        ) : (
          <span style={{fontSize:9.5,color:"#4A5066",flexShrink:0}}>in progress</span>
        )}
      </div>
    </div>
  );
}

function AllChallengesModal({ challengesByMode, stats, currentPlayer, rival, completions, onClaim, onClose }) {
  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={{...s.modalBox, maxHeight:"82vh", display:"flex", flexDirection:"column"}} onClick={(e)=>e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>all weekly challenges</div>
          <button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {challengesByMode.map(({ mode, challenges }) => (
            <div key={mode} style={{marginBottom:14}}>
              <div style={{fontSize:10.5,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:6}}>{mode.toUpperCase()}</div>
              {challenges.map((challenge, idx) => (
                <ChallengeCompactRow
                  key={`${mode}-${idx}`}
                  challenge={challenge}
                  mode={mode}
                  idxInMode={idx}
                  stats={stats}
                  currentPlayer={currentPlayer}
                  rival={rival}
                  completions={completions}
                  onClaim={onClaim}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatChallenges({ stats, currentPlayer, passXP, setPassXP, completions, setCompletions }) {
  const playerIdx = PLAYERS.findIndex(p => p.id === currentPlayer);
  const weekNum = Math.floor(Date.now() / (WEEK_MS));
  const [showAllModal, setShowAllModal] = useState(false);
  const [showRoom, setShowRoom] = useState(false);              

  const modes = ["3v3", "2v2", "1v1"];
  const challengesByMode = modes.map((mode) => {
    const modeChallenges = ALL_CHALLENGES.filter(c => c.mode === mode);
    const seedBase = weekNum * 31 + playerIdx * 7 + mode.length * 13;
    const shuffled = modeChallenges
      .map((c, i) => ({ c, key: ((seedBase + i * 17) * 2654435761) % 100000 }))
      .sort((a, b) => a.key - b.key)
      .map(x => x.c);
    const picked = shuffled.slice(0, Math.min(6, shuffled.length));
    return { mode, challenges: picked };
  });

  const rivals = PLAYERS.filter(p => p.id !== currentPlayer);
  const seed0 = weekNum * 31 + playerIdx * 7;
  const rival = rivals[seed0 % rivals.length];

const XP_PER_CHALLENGE = 17;
  const PASS_TIERS_PER_CHALLENGE = 1; // tiers awarded for first two challenges

const claimXP = async (claimKey, grantsBonusSpin, grantsPassTier) => {
    if (completions[claimKey]) return;
    const upd = {...completions, [claimKey]: true};
    setCompletions(upd);
    await storeSet("completions", upd);
    const pxp = await storeGet("pass_xp") || {};
    const tierBonus = grantsPassTier ? PASS_TIERS_PER_CHALLENGE * 100 : 0;
    // every claim grants +1 full pass tier (100 xp), plus any extra tier bonus
    const updXP = {...pxp, [currentPlayer]: (pxp[currentPlayer]||0)+XP_PER_CHALLENGE+tierBonus+XP_PER_TIER};
    setPassXP(updXP);
    await storeSet("pass_xp", updXP);
    // every claim grants +1 wheel spin and +1 slot spin, plus an extra one on bonus-spin challenges
    const bonusSpins = await storeGet("points") || {};
    const extraSpin = grantsBonusSpin ? 1 : 0;
    const updBonus = {
      ...bonusSpins,
      [currentPlayer+"_bonusSpins"]: (bonusSpins[currentPlayer+"_bonusSpins"]||0) + 1 + extraSpin,
      [currentPlayer+"_bonusSlots"]: (bonusSpins[currentPlayer+"_bonusSlots"]||0) + 1 + extraSpin,
    };
    await storeSet("points", updBonus);
  };

  // Default view: first challenge per mode (3 cards)
  const defaultItems = challengesByMode.map(({ mode, challenges }) => ({ challenge: challenges[0], mode, idxInMode: 0 }));

  return (
    <div style={{marginBottom:20}}>
      {showAllModal && (
        <AllChallengesModal
          challengesByMode={challengesByMode}
          stats={stats}
          currentPlayer={currentPlayer}
          rival={rival}
          completions={completions}
          onClaim={claimXP}
          onClose={()=>setShowAllModal(false)}
        />
      )}
      <div style={s.sectionRowHeader}>
        <div style={s.sectionLabel}>weekly challenges</div>
        <button onClick={()=>setShowAllModal(true)} className="bb-pressable" style={s.viewAllBtn}>
          view all 18 <ChevronRight size={12}/>
        </button>
      </div>
      {defaultItems.map((challengeItem) => {
        const { challenge, mode, idxInMode } = challengeItem;
        const rivalGames = stats.filter(g => g.playerId === rival.id && g.mode === "3v3");
        const rivalAvg = mode === "3v3" && challenge.field && rivalGames.length
          ? (rivalGames.reduce((s,g) => s+(g[challenge.field]||0),0)/rivalGames.length).toFixed(1)
          : null;
        const adjustedTarget = mode === "3v3" && challenge.type === "avg" && rivalAvg
          ? Math.max(Number(rivalAvg)+0.1, challenge.target)
          : challenge.target;
        const progress = getChallengeProgress({...challenge, target: adjustedTarget}, stats, currentPlayer);
        const claimKey = `challenge_${currentPlayer}_${weekNum}_${mode}_${idxInMode}`;
        const claimed = !!completions[claimKey];
        const grantsBonusSpin = idxInMode === 0 || idxInMode === 3;
        const modeLabel = `${{ "3v3":"3V3","2v2":"2V2","1v1":"1V1" }[mode]}`;
        const color = challenge.color;
        const progressPct = Math.min(1, progress.current / adjustedTarget);
        const descText = mode === "3v3" && rivalAvg
          ? challenge.desc(adjustedTarget.toFixed(1), rival.name)
          : challenge.desc(adjustedTarget);

        return (
          <div key={`${mode}-${idxInMode}`} style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:16,padding:"14px 16px",border:`1px solid ${color}22`,marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:10,color,fontWeight:700,letterSpacing:0.8}}>{modeLabel} CHALLENGE</div>
              <div style={{width:6,height:6,borderRadius:99,background:color}}/>
              {grantsBonusSpin && <div style={{fontSize:9,color:"#FFD166",fontWeight:700,marginLeft:"auto"}}>🎡 +spin</div>}
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
              <button onClick={()=>claimXP(claimKey, grantsBonusSpin, idxInMode===0||idxInMode===2)} className="bb-pressable bb-glow-lime"
                style={{width:"100%",background:color,border:"none",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,color:"#06070D",cursor:"pointer",marginBottom:8}}>
                🏆 claim +{XP_PER_CHALLENGE} xp + ⬆️ tier + 🎡 spin{grantsBonusSpin?" x2":""}
              </button>
            )}
            {claimed && <div style={{fontSize:12,color:"#7CFFB2",fontWeight:700,marginBottom:8}}>✓ +{XP_PER_CHALLENGE} xp claimed this week</div>}
            <div style={{fontSize:11,color:"#4A5066"}}>resets weekly · {mode} games only</div>
          </div>
        );
      })}
    </div>
  );
}
// ===================== Coach Note =====================
function getCoachNote(stats, playerId) {
  const todayKey = dateKey(todayAtMidnight());
  const playerGames = stats.filter(g => g.playerId === playerId && g.mode === "3v3");
  if (!playerGames.length) return null;
  // find the most recent day that has games, that isn't today
  const dayKeys = [...new Set(playerGames.map(g => dateKey(new Date(g.ts))))].filter(dk => dk < todayKey).sort().reverse();
  if (!dayKeys.length) return null;
  const lastNightKey = dayKeys[0];
  const lastNightGames = playerGames.filter(g => dateKey(new Date(g.ts)) === lastNightKey);
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

 return { ...note, date: lastNightKey, games: lastNightGames };
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
  const todayDk = dateKey(todayAtMidnight());

  // only look at TODAY's 3v3 games
  const todayGames = stats
    .filter(g => g.mode === "3v3" && dateKey(new Date(g.ts)) === todayDk)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  if (!todayGames.length) return [];

  // group by timestamp into "slots" (games played at same moment)
  const slotMap = {};
  todayGames.forEach(g => {
    if (!slotMap[g.ts]) slotMap[g.ts] = [];
    slotMap[g.ts].push(g);
  });

  const slots = Object.entries(slotMap)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([ts, games]) => ({ ts, games }));

  // find the current win streak from the most recent games
  let streak = 0;
  const streakGames = [];

  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    const isWin = slot.games.some(g => g.ourScore > g.theirScore);
    if (isWin) {
      streak++;
      streakGames.unshift(slot);
    } else {
      break;
    }
  }

  if (streak < 1) return [];

  return [{ dk: todayDk, games: streakGames, peak: streak }];
}

function heatMultiplier(wins) {
  if (wins >= 7) return 10;
  if (wins >= 6) return 7;
  if (wins >= 5) return 4;
  if (wins >= 4) return 2;
  return 1;
}

function HeatStreakCard({ stats, currentPlayer }) {
  const [selectedGame, setSelectedGame] = useState(null);

  const todayDk = dateKey(todayAtMidnight());
  const streaks = getNightStreaks(stats);
  const todayStreak = streaks[0];

  if (!todayStreak || todayStreak.games.length === 0) {
    return (
      <div style={{ background: "#11131F", borderRadius: 14, padding: "18px 16px", border: "1px solid rgba(255,140,50,0.1)", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>♨️</div>
        <div style={{ fontSize: 13, color: "#4A5066" }}>no wins yet today — start a streak</div>
      </div>
    );
  }

  const mult = heatMultiplier(todayStreak.peak);
  const flameEmojis = "🔥".repeat(Math.min(todayStreak.peak, 8));
console.log("todayStreak.games.length:", todayStreak.games.length, "peak:", todayStreak.peak);

  return (
    <>
      {/* Game detail overlay */}
      {selectedGame && (
        <div
          onClick={() => setSelectedGame(null)}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(4,8,24,0.92)", display: "flex", alignItems: "center", justifyContent: "center", animation: "chatFadeIn .2s ease", padding: "0 20px" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "linear-gradient(135deg,#11131F,#0C0E18)", borderRadius: 22, padding: "24px 20px", width: "100%", maxWidth: 380, border: "1px solid rgba(255,140,50,0.3)", animation: "scaleFadeIn .25s cubic-bezier(.2,.8,.2,1)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: "#FF8C32", fontWeight: 700, letterSpacing: 1 }}>GAME DETAIL</div>
              <button onClick={() => setSelectedGame(null)} style={{ background: "none", border: "none", color: "#4A5066", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 42, fontWeight: 700, textAlign: "center", marginBottom: 6, color: "#E8ECF4" }}>
  {selectedGame.games[0]?.ourScore} – {selectedGame.games[0]?.theirScore}
</div>
            <div style={{ textAlign: "center", fontSize: 11, color: "#7CFFB2", fontWeight: 700, marginBottom: 20 }}>WIN · {heatMultiplier(selectedGame.gameNum)}x xp</div>
            {PLAYERS.map(p => {
              const pg = selectedGame.games.find(g => g.playerId === p.id);
              return (
                <div key={p.id} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 13, padding: "12px 14px", marginBottom: 8, border: `1px solid ${pg ? p.color + "33" : "rgba(255,255,255,0.04)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: pg ? 10 : 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: pg ? p.color : "#2E3346" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: pg ? p.color : "#4A5066" }}>{p.name}</span>
                    {!pg && <span style={{ fontSize: 11, color: "#4A5066", fontStyle: "italic" }}>didn't log</span>}
                  </div>
                  {pg && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                      {[["goals", pg.goals], ["assists", pg.assists], ["saves", pg.saves], ["shots", pg.shots], ["demos", pg.demos]].map(([label, val]) => (
                        <div key={label} style={{ textAlign: "center", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 2px" }}>
                          <div style={{ fontSize: 9, color: "#4A5066", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: p.color }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main streak card */}
      <div style={{ background: "linear-gradient(135deg,#1A0A00,#2A1000)", border: "1px solid rgba(255,140,50,0.4)", borderRadius: 18, padding: "16px", boxShadow: "0 0 24px rgba(255,140,50,0.12)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: "#FF8C32", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>TONIGHT'S STREAK</div>
            <div style={{ fontSize: 22, letterSpacing: 2 }}>{flameEmojis}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 28, fontWeight: 700, color: "#FF8C32" }}>
              {todayStreak.peak}
              <span style={{ fontSize: 13, color: "#8B92A8", marginLeft: 6 }}>wins</span>
            </div>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 20, fontWeight: 700, color: "#FFD166" }}>{mult}x</div>
            <div style={{ fontSize: 10, color: "#8B92A8" }}>pass xp bonus</div>
          </div>
        </div>

        {/* Game list — only tonight's streak games */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {todayStreak.games.map((slot, i) => {
            const rep = slot.games[0];
            const gameNum = i + 1;
            return (
              <button
                key={i}
                onClick={() => setSelectedGame({ ...slot, gameNum })}
                className="bb-pressable"
                style={{ background: "rgba(255,140,50,0.06)", borderRadius: 12, padding: "10px 12px", border: "1px solid rgba(255,140,50,0.15)", textAlign: "left", cursor: "pointer", width: "100%" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{"🔥".repeat(Math.min(gameNum, 5))}</span>
                <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 18, fontWeight: 700, color: "#E8ECF4" }}>{rep.ourScore}–{rep.theirScore}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 10, color: "#FFD166", fontWeight: 700 }}>{heatMultiplier(gameNum)}x xp</div>
                    <div style={{ fontSize: 10, color: "#7CFFB2", fontWeight: 700 }}>W #{gameNum}</div>
                  </div>
                </div>
                {/* Mini player row */}
                <div style={{ display: "flex", gap: 10 }}>
                  {PLAYERS.map(p => {
                    const pg = slot.games.find(g => g.playerId === p.id);
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 5, height: 5, borderRadius: 99, background: pg ? p.color : "#2E3346", flexShrink: 0 }} />
                        {pg ? (
                          <span style={{ fontSize: 10, color: "#8B92A8" }}>{pg.goals}g {pg.assists}a {pg.saves}sv</span>
                        ) : (
                          <span style={{ fontSize: 10, color: "#3A4256", fontStyle: "italic" }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: "#4A5066", marginTop: 4 }}>tap to expand →</div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}  function TimePlayedTracker({ stats, currentPlayer, timeLogs, setTimeLogs }) {
  const [logging, setLogging] = useState(false);
  const [hours1v1, setHours1v1] = useState("");
  const [hours2v2, setHours2v2] = useState("");
  const [hours3v3, setHours3v3] = useState("");
  const [hoursPractice, setHoursPractice] = useState("");

  const weekStart = getWeekStart();
  const weekKey = dateKey(weekStart);
  const weekNum = Math.max(0, Math.floor((weekStart - TRAINING_START) / WEEK_MS));
  const weeklyGoal = TIME_GOALS_BY_WEEK[Math.min(weekNum, TIME_GOALS_BY_WEEK.length - 1)];

  const myLogs = (timeLogs || []).filter(l => l.playerId === currentPlayer && l.weekKey === weekKey);
  const totalHours = myLogs.reduce((s, l) => s + (l.total || 0), 0);
  const pct = Math.min(1, totalHours / weeklyGoal);

  const breakdown = { "1v1": 0, "2v2": 0, "3v3": 0, practice: 0 };
  myLogs.forEach(l => {
    breakdown["1v1"] += l.h1v1 || 0;
    breakdown["2v2"] += l.h2v2 || 0;
    breakdown["3v3"] += l.h3v3 || 0;
    breakdown.practice += l.hPractice || 0;
  });

  const submit = async () => {
    const h1 = parseFloat(hours1v1) || 0;
    const h2 = parseFloat(hours2v2) || 0;
    const h3 = parseFloat(hours3v3) || 0;
    const hp = parseFloat(hoursPractice) || 0;
    const total = h1 + h2 + h3 + hp;
    if (total <= 0) return;
    const entry = {
      id: Date.now().toString(),
      playerId: currentPlayer,
      weekKey,
      h1v1: h1, h2v2: h2, h3v3: h3, hPractice: hp,
      total,
      loggedAt: new Date().toISOString(),
    };
    const upd = [...(timeLogs || []), entry];
    setTimeLogs(upd);
    await storeSet("time_logs", upd);
    setHours1v1(""); setHours2v2(""); setHours3v3(""); setHoursPractice("");
    setLogging(false);
  };

  const playerColor = PLAYERS.find(p => p.id === currentPlayer)?.color || "#B8FF4D";
  const remaining = Math.max(0, weeklyGoal - totalHours);

  return (
    <div style={{marginBottom:20}}>
      <div style={{...s.sectionLabel,marginBottom:10}}>time played this week</div>
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:16,padding:"14px 16px",border:`1px solid ${playerColor}22`,marginBottom:logging?10:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:700,color:playerColor}}>{totalHours.toFixed(1)}<span style={{fontSize:13,color:"#4A5066",marginLeft:4}}>/ {weeklyGoal}h</span></div>
            <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{remaining > 0 ? `${remaining.toFixed(1)}h to go this week` : "weekly goal hit 🎉"}</div>
          </div>
          <button onClick={() => setLogging(v => !v)} className="bb-pressable bb-glow-lime"
            style={{background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"8px 14px",fontSize:11.5,fontWeight:700,color:"#B8FF4D",cursor:"pointer"}}>
            + log time
          </button>
        </div>
        <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden",marginBottom:10}}>
          <div style={{height:"100%",width:`${pct*100}%`,background:pct>=1?"#7CFFB2":playerColor,borderRadius:99,transition:"width .4s ease",boxShadow:`0 0 8px ${playerColor}88`}}/>
        </div>
        <div style={{display:"flex",gap:12}}>
          {[["1v1",breakdown["1v1"],"#4D9EFF"],["2v2",breakdown["2v2"],"#FF61C1"],["3v3",breakdown["3v3"],"#B8FF4D"],["practice",breakdown.practice,"#A78BFA"]].map(([label,val,col])=>(
            <div key={label} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:9,color:"#4A5066",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:3}}>{label}</div>
              <div style={{fontSize:14,fontWeight:700,color:col}}>{val.toFixed(1)}h</div>
            </div>
          ))}
        </div>
      </div>

      {logging && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:12}}>LOG SESSION — HOURS PLAYED</div>
          {[["1v1 ranked",hours1v1,setHours1v1],["2v2 ranked",hours2v2,setHours2v2],["3v3 ranked",hours3v3,setHours3v3],["free play / practice",hoursPractice,setHoursPractice]].map(([label,val,setter])=>(
            <div key={label} style={{marginBottom:10}}>
              <div style={{fontSize:11,color:"#8B92A8",marginBottom:4}}>{label}</div>
              <input type="number" step="0.25" min="0" max="12" value={val} onChange={e=>setter(e.target.value)}
                placeholder="0" style={{...s.modalInput,textAlign:"center"}}/>
            </div>
          ))}
          <div style={{fontSize:11,color:"#4A5066",marginBottom:10}}>total: {(parseFloat(hours1v1)||0)+(parseFloat(hours2v2)||0)+(parseFloat(hours3v3)||0)+(parseFloat(hoursPractice)||0)}h</div>
          <button onClick={submit} className="bb-pressable bb-glow-lime" style={s.primaryBtn}>save session</button>
        </div>
      )}
    </div>
  );
}    
            function ExpandedStatModal({ stat, record, schedule, onClose }) {
  const expandedSwipe = useSwipeRightToClose(onClose);
  return (
    <div {...expandedSwipe.swipeHandlers} style={{position:"fixed",inset:0,zIndex:400,background:"#040818",display:"flex",flexDirection:"column",animation:"chatPanelIn .22s cubic-bezier(.2,.8,.2,1)",...expandedSwipe.swipeStyle}}>
  <FullScreenHeader title={stat === "record" ? "series record" : stat === "diff" ? "goal differential" : "goals for"} subtitle="season detail" onClose={onClose} accent="#B8FF4D" />
      <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
        {stat === "record" && (
          <>
            <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"24px",textAlign:"center",marginBottom:20,border:"1px solid rgba(184,255,77,0.15)"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:56,fontWeight:700,color:"#B8FF4D"}}>{record.w}-{record.l}</div>
              <div style={{fontSize:12,color:"#4A5066",letterSpacing:1,marginTop:4}}>SERIES RECORD</div>
            </div>
            <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>MATCH HISTORY</div>
            {schedule.league.filter(m=>m.result).map(m=>{
              const won = m.result.status==="win"||m.result.status==="forfeit_win"||m.result.status==="bye";
              return (
                <div key={m.id} style={{background:"#11131F",borderRadius:13,padding:"13px 14px",marginBottom:8,border:`1px solid ${won?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:11,color:"#B8FF4D",fontWeight:700,marginBottom:2}}>{m.label}</div>
                    <div style={{fontSize:14,fontWeight:600}}>{m.opponent||"tbd"}</div>
                    <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{m.dateRange}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {m.result.ours!==undefined&&<div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,marginBottom:4}}>{m.result.ours}–{m.result.theirs}</div>}
                    <div style={{fontSize:10,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A",border:`1px solid ${won?"rgba(124,255,178,0.4)":"rgba(255,92,138,0.4)"}`,borderRadius:99,padding:"2px 8px"}}>{m.result.status.replace("_"," ")}</div>
                  </div>
                </div>
              );
            })}
            {schedule.league.filter(m=>m.result).length===0&&<div style={{color:"#4A5066",textAlign:"center",marginTop:40,fontSize:13}}>no matches played yet</div>}
          </>
        )}
        {stat === "diff" && (
          <>
            <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"24px",textAlign:"center",marginBottom:20,border:"1px solid rgba(184,255,77,0.15)"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:56,fontWeight:700,color:record.gf-record.ga>=0?"#7CFFB2":"#FF5C8A"}}>{record.gf-record.ga>=0?"+":""}{record.gf-record.ga}</div>
              <div style={{fontSize:12,color:"#4A5066",letterSpacing:1,marginTop:4}}>GOAL DIFFERENTIAL</div>
            </div>
            <div style={{display:"flex",gap:12,marginBottom:20}}>
              <div style={{flex:1,background:"#11131F",borderRadius:14,padding:"16px",textAlign:"center",border:"1px solid rgba(124,255,178,0.15)"}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:32,fontWeight:700,color:"#7CFFB2"}}>{record.gf}</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:4}}>GOALS FOR</div>
              </div>
              <div style={{flex:1,background:"#11131F",borderRadius:14,padding:"16px",textAlign:"center",border:"1px solid rgba(255,92,138,0.1)"}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:32,fontWeight:700,color:"#FF5C8A"}}>{record.ga}</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:4}}>GOALS AGAINST</div>
              </div>
            </div>
            <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>BY MATCH</div>
            {schedule.league.filter(m=>m.result&&m.result.ours!==undefined).map(m=>{
              const diff = m.result.ours - m.result.theirs;
              return (
                <div key={m.id} style={{background:"#11131F",borderRadius:13,padding:"13px 14px",marginBottom:8,border:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:11,color:"#B8FF4D",fontWeight:700,marginBottom:2}}>{m.label}</div>
                    <div style={{fontSize:13,color:"#8B92A8"}}>{m.opponent||"tbd"}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700}}>{m.result.ours}–{m.result.theirs}</div>
                    <div style={{fontSize:12,fontWeight:700,color:diff>=0?"#7CFFB2":"#FF5C8A"}}>{diff>=0?"+":""}{diff}</div>
                  </div>
                </div>
              );
            })}
            {schedule.league.filter(m=>m.result&&m.result.ours!==undefined).length===0&&<div style={{color:"#4A5066",textAlign:"center",marginTop:40,fontSize:13}}>no matches played yet</div>}
          </>
        )}
        {stat === "gf" && (
          <>
            <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"24px",textAlign:"center",marginBottom:20,border:"1px solid rgba(184,255,77,0.15)"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:56,fontWeight:700,color:"#B8FF4D"}}>{record.gf}</div>
              <div style={{fontSize:12,color:"#4A5066",letterSpacing:1,marginTop:4}}>TOTAL GOALS FOR</div>
            </div>
            <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>BY MATCH</div>
            {schedule.league.filter(m=>m.result&&m.result.ours!==undefined).map(m=>(
              <div key={m.id} style={{background:"#11131F",borderRadius:13,padding:"13px 14px",marginBottom:8,border:"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:11,color:"#B8FF4D",fontWeight:700,marginBottom:2}}>{m.label}</div>
                  <div style={{fontSize:13,color:"#8B92A8"}}>{m.opponent||"tbd"}</div>
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#B8FF4D"}}>{m.result.ours} goals</div>
              </div>
            ))}
            {schedule.league.filter(m=>m.result&&m.result.ours!==undefined).length===0&&<div style={{color:"#4A5066",textAlign:"center",marginTop:40,fontSize:13}}>no matches played yet</div>}
          </>
        )}
      </div>
    </div>
  );
}
function TeamComparisonModal({ stats, currentPlayer, onClose }) {
  const comparisonSwipe = useSwipeRightToClose(onClose);

  const modeGames = stats.filter(g => g.mode === "3v3");
  const avg = (arr, field) => arr.length ? (arr.reduce((s,g) => s+(g[field]||0),0)/arr.length).toFixed(1) : "—";
  const winRate = (arr) => arr.length ? Math.round((arr.filter(g=>g.ourScore>g.theirScore).length/arr.length)*100)+"%" : "—";
  const ALL_FIELDS = ["goals","assists","saves","shots","score","demos"];

  return (
   <div
  {...comparisonSwipe.swipeHandlers}
  style={{
    position:"fixed", inset:0, zIndex:500, background:"#040818",
    display:"flex", flexDirection:"column",
    animation:"chatPanelIn .24s cubic-bezier(.2,.8,.2,1)",
    ...comparisonSwipe.swipeStyle,
  }}>
     <FullScreenHeader title="team comparison · 3v3" subtitle="team stats" onClose={onClose} accent="#A78BFA" />
      <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
        {PLAYERS.map(p => {
          const pg = modeGames.filter(g => g.playerId === p.id);
          const wins = pg.filter(g => g.ourScore > g.theirScore).length;
          const losses = pg.length - wins;
          const isMe = p.id === currentPlayer;
          return (
            <div key={p.id} style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"18px 16px",marginBottom:14,border:`1px solid ${p.color}22`,boxShadow:isMe?`0 0 20px ${p.color}18`:"none"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:10,height:10,borderRadius:99,background:p.color,boxShadow:`0 0 8px ${p.color}99`}}/>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:p.color}}>{p.name}</span>
                  {isMe && <span style={{fontSize:9,color:p.color,fontWeight:700,background:`${p.color}22`,padding:"2px 7px",borderRadius:99}}>YOU</span>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#E8ECF4"}}>{wins}W – {losses}L</div>
                  <div style={{fontSize:10,color:"#4A5066",marginTop:1}}>{pg.length} games · {winRate(pg)} win rate</div>
                </div>
              </div>
              {pg.length === 0 ? (
                <div style={{fontSize:13,color:"#4A5066",textAlign:"center",padding:"10px 0"}}>no 3v3 games logged yet</div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {ALL_FIELDS.map(f => (
                    <div key={f} style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"10px 8px",textAlign:"center",border:"1px solid rgba(255,255,255,0.04)"}}>
                      <div style={{fontSize:9,color:"#4A5066",fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,marginBottom:6}}>{f}</div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:p.color}}>{avg(pg,f)}</div>
                      <div style={{fontSize:9.5,color:"#4A5066",marginTop:3}}>per game</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
          
function LiveMMRFeed({ mmrProfiles }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{fontSize:12,letterSpacing:1,color:"#4A5066",fontWeight:700,marginBottom:8}}>live mmr · all players</div>
      {PLAYERS.map(p => {
        const profile = mmrProfiles[p.id];
        if (!profile?.ranks) return (
          <div key={p.id} style={{background:"#11131F",borderRadius:13,padding:"11px 14px",marginBottom:8,border:"1px solid rgba(255,255,255,0.05)",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:8,height:8,borderRadius:99,background:p.color}}/>
            <span style={{fontSize:13,fontWeight:700,color:p.color}}>{p.name}</span>
            <span style={{fontSize:11,color:"#4A5066",marginLeft:"auto"}}>not synced yet</span>
          </div>
        );
        const isOpen = expanded === p.id;
        const standardRank = profile.ranks.find(r => r.playlist === "Ranked Standard 3v3");
        return (
          <div key={p.id}>
            <button onClick={() => setExpanded(isOpen ? null : p.id)} className="bb-pressable"
              style={{width:"100%",background:"#11131F",borderRadius:isOpen?"13px 13px 0 0":"13px",padding:"12px 14px",marginBottom:isOpen?0:8,border:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",gap:10,cursor:"pointer",textAlign:"left"}}>
              <div style={{width:9,height:9,borderRadius:99,background:p.color,boxShadow:`0 0 8px ${p.color}88`,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:p.color}}>{p.name}</div>
                <div style={{fontSize:11,color:"#8B92A8",marginTop:1}}>{standardRank?.rank || "unranked"} · 3v3</div>
              </div>
              <div style={{textAlign:"right",marginRight:8}}>
              </div>
              <ChevronRight size={14} color="#4A5066" style={{transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s",flexShrink:0}}/>
            </button>
            {isOpen && (
              <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderTop:"none",borderRadius:"0 0 13px 13px",padding:"12px 14px",marginBottom:8}}>
                {profile.ranks.map(r => {
                  const label = r.playlist === "Ranked Duel 1v1" ? "1v1" : r.playlist === "Ranked Doubles 2v2" ? "2v2" : "3v3";
                  const diff = r.prevMmr ? r.mmr - r.prevMmr : null;
                  return (
                    <div key={r.playlist} style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:10,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                      <div>
                        <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:3}}>{label}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
  {getRankImage(r.rank) && (
    <img
      src={getRankImage(r.rank)}
      alt={r.rank}
      style={{width:26,height:26,objectFit:"contain",flexShrink:0}}
    />
  )}
  <div style={{fontSize:13,fontWeight:700,color:p.color}}>{r.rank}</div>
</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
          
          

function ProfileHomeTab({ currentPlayer, points, setPoints }) {
  const owned = points?.[currentPlayer + "_owned"] || [];
  const equipped = points?.[currentPlayer + "_equipped"] || {};
  const myPoints = points?.[currentPlayer] || 0;
  const player = PLAYERS.find(p => p.id === currentPlayer);
  const passOwned = owned.filter(id => id.startsWith("pass_"));
  const shopOwned = owned.filter(id => SHOP_ITEMS.find(i => i.id === id));
  const itemLabel = (id) => {
    const shopItem = SHOP_ITEMS.find(i => i.id === id);
    if (shopItem) return shopItem.label || shopItem.value || id;
    if (id.startsWith("pass_")) return getPassRewardForOwnedId(id)?.label || id;
    return id;
  };
  const itemIcon = (id) => {
    const shopItem = SHOP_ITEMS.find(i => i.id === id);
    if (shopItem?.emoji) return shopItem.emoji;
    const reward = id.startsWith("pass_") ? getPassRewardForOwnedId(id) : null;
    if (reward?.type === "icon") return reward.value;
    if (reward?.type === "color") return "●";
    if (reward?.type === "text_color") return "Aa";
    if (reward?.type === "title") return "T";
    return "◆";
  };
  const itemType = (id) => SHOP_ITEMS.find(i => i.id === id)?.type || (id.startsWith("pass_") ? getPassRewardForOwnedId(id)?.type : null);
  const toggleEquip = async (id) => {
    const type = itemType(id);
    if (!type || !["color","icon","title","background","text_color"].includes(type)) return;
    const newEquipped = { ...equipped };
    owned.forEach(ownedId => { if (itemType(ownedId) === type) delete newEquipped[ownedId]; });
    if (!equipped[id]) newEquipped[id] = true;
    const upd = { ...points, [currentPlayer + "_equipped"]: newEquipped };
    setPoints(upd);
    await storeSet("points", upd);
  };
  const textKitId = owned.find(id => equipped[id] && itemType(id) === "text_color");
  const renderOwned = (title, ids) => (
    <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:14,marginBottom:14}}>
      <div style={{fontSize:10,color:"#4A5066",fontWeight:900,letterSpacing:1,marginBottom:10}}>{title}</div>
      {ids.length === 0 ? <div style={{fontSize:12,color:"#4A5066"}}>nothing owned yet.</div> : (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {ids.map(id => (
            <div key={id} style={{background:equipped[id]?"rgba(184,255,77,0.09)":"rgba(255,255,255,0.035)",border:`1px solid ${equipped[id]?"rgba(184,255,77,0.28)":"rgba(255,255,255,0.06)"}`,borderRadius:12,padding:"10px 8px",minHeight:64}}>
              <div style={{fontSize:18,marginBottom:5,color:player?.color}}>{itemIcon(id)}</div>
              <div style={{fontSize:11,fontWeight:800,color:"#E8ECF4",lineHeight:1.2}}>{itemLabel(id)}</div>
              {["color","icon","title","background","text_color"].includes(itemType(id)) && (
                <button onClick={()=>toggleEquip(id)} className="bb-pressable" style={{marginTop:8,width:"100%",background:equipped[id]?"#B8FF4D":"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:"6px 0",fontSize:10,fontWeight:800,color:equipped[id]?"#06070D":"#8B92A8",cursor:"pointer"}}>
                  {equipped[id] ? "equipped" : "equip"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div>
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.16)",borderRadius:18,padding:16,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:11,height:11,borderRadius:99,background:player?.color,boxShadow:`0 0 10px ${player?.color}99`}} />
          <div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#E8ECF4"}}>{player?.name}</div>
            <div style={{fontSize:11,color:"#4A5066",fontWeight:700}}>profile inventory</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:900}}>POINTS</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,color:"#B8FF4D",fontWeight:700}}>{myPoints}</div>
        </div>
      </div>
      {renderOwned("OWNED FROM PASS", passOwned)}
      {renderOwned("OWNED FROM SHOP", shopOwned)}
      {textKitId && (
        <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.16)",borderRadius:16,padding:14,marginBottom:14}}>
          <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900,letterSpacing:1,marginBottom:10}}>CUSTOM TEXT KIT</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {[["main","main text", "#E8ECF4"],["muted","small text", "#8B92A8"],["accent","accent text", "#B8FF4D"]].map(([part,label,fallback]) => (
              <label key={part} style={{fontSize:9,color:"#8B92A8",fontWeight:800,textTransform:"uppercase",letterSpacing:0.5}}>
                {label}
                <input type="color" value={(points?.[currentPlayer+"_textColors"]||{})[part] || fallback} onChange={async(e)=>{ const cur = points?.[currentPlayer+"_textColors"] || {}; const upd = { ...points, [currentPlayer+"_textColors"]: { ...cur, [part]: e.target.value } }; setPoints(upd); await storeSet("points", upd); }} style={{width:"100%",height:34,marginTop:6,background:"none",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:0,cursor:"pointer"}} />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== Home Tab =====================
function HomeTab({ schedule, mmrProfiles, currentPlayer, points, setPoints, onResync, resyncingId, trainingData, completions, onGotoTraining, stats, setCompletions, onGotoStats, statsJumpDate, setStatsJumpDate, passXP, setPassXP, timeLogs, setTimeLogs, onOpenBracket }) {
  const allMatches = [...schedule.league, ...schedule.playoffs];
  const now = new Date();
  const nextMatch = allMatches.find((m)=>!m.result);
  const [showTeamComparison, setShowTeamComparison] = useState(null);
  const [expandedStat, setExpandedStat] = useState(null);
const [homeSubTab, setHomeSubTab] = useState("overview");    
  useEffect(() => {
  setShowTeamComparison(false);
  setExpandedStat(null);
}, []);    
  const record = schedule.league.reduce((acc,m)=>{
    if (!m.result) return acc;
    if (m.result.status==="win"||m.result.status==="forfeit_win"||m.result.status==="bye") acc.w++; else acc.l++;
    acc.gf += m.result.ours||0; acc.ga += m.result.theirs||0;
    return acc;
  },{ w:0, l:0, gf:0, ga:0 });
  const daysUntil = nextMatch ? Math.max(0, Math.ceil((new Date(nextMatch.start)-now)/DAY_MS)) : null;
  const today = todayAtMidnight();
  const previewDays = Array.from({length:5},(_,i)=>{ const date=new Date(today.getTime()+i*DAY_MS); const key=dateKey(date); return {key,date,training:trainingData[tKey(key,currentPlayer)]||null}; });

const weeklyEvent = getWeeklyEvent();

return (
  <div className="bb-tab-content" style={s.tabContent}>
    {expandedStat && <ExpandedStatModal stat={expandedStat} record={record} schedule={schedule} onClose={() => setExpandedStat(null)} />}
    {showTeamComparison && <TeamComparisonModal stats={stats} currentPlayer={currentPlayer} onClose={()=>setShowTeamComparison(false)}/>}

    {/* Sub-tab switcher */}
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      <button onClick={()=>setHomeSubTab("overview")} className="bb-pressable"
        style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:homeSubTab==="overview"?"#B8FF4D":"rgba(255,255,255,0.05)",color:homeSubTab==="overview"?"#06070D":"#8B92A8"}}>
        🏠 overview
      </button>
      <button onClick={()=>setHomeSubTab("profile")} className="bb-pressable"
        style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:homeSubTab==="profile"?"#B8FF4D":"rgba(255,255,255,0.05)",color:homeSubTab==="profile"?"#06070D":"#8B92A8"}}>
        profile
      </button>
    </div>

    {homeSubTab==="profile" && <ProfileHomeTab currentPlayer={currentPlayer} points={points} setPoints={setPoints} />}

    {homeSubTab==="overview" && <>
      <div style={{background:`linear-gradient(135deg,${weeklyEvent.color}18,${weeklyEvent.color}08)`,border:`1px solid ${weeklyEvent.color}40`,borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:26,flexShrink:0}}>{weeklyEvent.emoji}</span>
        <div>
          <div style={{fontSize:10,color:weeklyEvent.color,fontWeight:700,letterSpacing:1,marginBottom:3}}>THIS WEEK'S MODIFIER</div>
          <div style={{fontSize:14,fontWeight:700,color:"#E8ECF4",marginBottom:2}}>{weeklyEvent.title}</div>
          <div style={{fontSize:11.5,color:"#8B92A8",lineHeight:1.4}}>{weeklyEvent.desc}</div>
        </div>
      </div>

      <div onClick={onOpenBracket} className="bb-pressable" style={{...s.heroCard,cursor:"pointer"}}>
        <div style={s.heroEyebrow}>{nextMatch?(nextMatch.type==="playoff"?"next — playoffs":"next matchup"):"season complete"}</div>
        {nextMatch ? (
          <>
            <div style={s.heroMatchup}>
              <div style={s.heroTeam}><div style={s.heroTeamName}>burton<br/>battlers</div></div>
              <div style={s.heroVs}><div style={s.heroBo}>bo{nextMatch.bestOf}</div>vs</div>
              <div style={s.heroTeam}><div style={{...s.heroTeamName,color:nextMatch.opponent?"#E8ECF4":"#4A5066"}}>{nextMatch.opponent||"tbd"}</div></div>
            </div>
            <div style={s.heroMeta}>{nextMatch.label} · {daysUntil===0?"this week":`in ${daysUntil}d`} · {nextMatch.dateRange}</div>
            <div style={{fontSize:10,color:"#B8FF4D",fontWeight:700,letterSpacing:.6,marginTop:8}}>tap to open full bracket</div>
          </>
        ) : <div style={s.heroMatchup}><div style={s.heroTeamName}>gg. see you next circuit.</div></div>}
      </div>

      <div style={s.recordRow}>
        <div onClick={()=>setExpandedStat("record")} className="bb-pressable" style={{...s.recordBox,cursor:"pointer"}}>
          <div style={s.recordNum}>{record.w}-{record.l}</div>
          <div style={s.recordLabel}>series record</div>
        </div>
        <div onClick={()=>setExpandedStat("diff")} className="bb-pressable" style={{...s.recordBox,cursor:"pointer"}}>
          <div style={s.recordNum}>{record.gf-record.ga>=0?"+":""}{record.gf-record.ga}</div>
          <div style={s.recordLabel}>goal diff</div>
        </div>
        <div onClick={()=>setExpandedStat("gf")} className="bb-pressable" style={{...s.recordBox,cursor:"pointer"}}>
          <div style={s.recordNum}>{record.gf}</div>
          <div style={s.recordLabel}>goals for</div>
        </div>
      </div>

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
            <div key={day.key} onClick={()=>onGotoTraining(day.key)} className="bb-pressable bb-glow-violet"
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

      {stats.some(g=>g.playerId===currentPlayer&&g.mode==="3v3") ? (
        <CoachNoteCard stats={stats} currentPlayer={currentPlayer} onJumpToLog={(date) => { setStatsJumpDate(date); onGotoStats(); }}/>
      ) : (
        <EmptyState icon="⌁" title="No 3v3 games synced yet" body="After your next team match, open Stats → Sync Match and your coach note + comparison data will fill in." actionLabel="open stats" onAction={onGotoStats} />
      )}
      <button onClick={()=>{ setShowTeamComparison(true); }} className="bb-pressable" style={{width:"100%",background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:16,padding:"14px 16px",border:"1px solid rgba(255,255,255,0.06)",marginBottom:16,textAlign:"left",cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1}}>TEAM COMPARISON · 3V3</div>
          <ChevronRight size={14} color="#4A5066"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:`60px repeat(4,1fr)`,gap:4,marginBottom:8}}>
          <div/>
          {["goals","assists","saves","shots"].map(f=><div key={f} style={{fontSize:9,color:"#4A5066",fontWeight:700,textAlign:"center",textTransform:"uppercase",letterSpacing:0.5}}>{f}</div>)}
        </div>
        {PLAYERS.map(p=>{
          const pg = stats.filter(g=>g.playerId===p.id&&g.mode==="3v3");
          const avg = (field) => pg.length ? (pg.reduce((s,g) => s+(Number(g[field])||0),0)/pg.length).toFixed(1) : "—";
          return (
            <div key={p.id} style={{display:"grid",gridTemplateColumns:`60px repeat(4,1fr)`,gap:4,marginBottom:6,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:6,height:6,borderRadius:99,background:p.color,flexShrink:0}}/>
                <span style={{fontSize:10,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:p.id===currentPlayer?p.color:"#E8ECF4"}}>{p.name}</span>
              </div>
              {["goals","assists","saves","shots"].map(f=>(
                <div key={f} style={{fontSize:12,fontWeight:700,color:p.color,textAlign:"center"}}>{avg(f)}</div>
              ))}
            </div>
          );
        })}
        <div style={{fontSize:10,color:"#4A5066",marginTop:8}}>tap for full breakdown →</div>
      </button>
      <StatChallenges stats={stats} currentPlayer={currentPlayer} completions={completions} setCompletions={setCompletions} passXP={passXP} setPassXP={setPassXP}/>
    </>}
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
  const [proofFile,setProofFile]=useState(null);
  const [proofUploading,setProofUploading]=useState(false);
  const [proofUrl,setProofUrl]=useState(completion?.proofUrl||"");
  const fileRef=useRef(null);
  useEffect(()=>{ setProofUrl(completion?.proofUrl||""); setProofFile(null); },[completion?.proofUrl,day.key]);
  const submitLocked = completion?.status==="pending"||completion?.status==="approved";
  const proofReady = !!proofUrl;
  const chooseProof = async (file) => {
    if (!file) return;
    setProofFile(file);
    setProofUploading(true);
    try {
      const uploaded = await uploadPostImage(file);
      setProofUrl(uploaded);
    } catch(e) {
      setProofUrl("");
    }
    setProofUploading(false);
  };

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
          <input ref={fileRef} type="file" accept="image/*,video/*" style={{display:"none"}} onChange={(e)=>chooseProof(e.target.files?.[0])}/>
          <button disabled={submitLocked || proofUploading} onClick={()=>fileRef.current?.click()} className="bb-pressable"
            style={{width:"100%",background:proofReady?"rgba(184,255,77,0.08)":"rgba(255,255,255,0.04)",border:`1px solid ${proofReady?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.08)"}`,borderRadius:11,padding:"10px 12px",fontSize:12,fontWeight:700,color:proofReady?"#B8FF4D":"#8B92A8",cursor:submitLocked?"default":"pointer",margin:"10px 0"}}>
            {proofUploading?"uploading proof…":proofReady?`proof attached${proofFile?` · ${proofFile.name}`:""}`:"upload clip or screenshot proof"}
          </button>
          {isNumeric ? (
            <div style={s.numericWrap}>
              <div style={s.numericLabel}>target: {training.targetAmount} {training.unit||"reps"}</div>
              <button disabled={submitLocked || proofUploading || !proofReady} onClick={()=>onSubmitNumeric(day.key, training.targetAmount, proofUrl)} className="bb-pressable"
                style={{...s.completeBtn,background:(submitLocked?"rgba(255,255,255,0.04)":proofReady?"#B8FF4D":"rgba(255,255,255,0.05)"),color:submitLocked?"#7CFFB2":proofReady?"#06070D":"#4A5066",cursor:submitLocked||!proofReady?"default":"pointer",marginTop:10}}>
                {completion?.status==="approved"?<><Check size={15}/> approved</>:completion?.status==="pending"?"submitted — awaiting review":completion?.status==="rejected"?"resubmit":"submit proof for review"}
              </button>
              <div style={{marginTop:8,display:"flex",justifyContent:"flex-end"}}><button onClick={()=>onOpenComments(day.key)} className="bb-pressable" style={s.commentBtn}><MessageCircle size={15}/></button></div>
            </div>
          ) : (
            <div style={s.trainingActions}>
              <button disabled={submitLocked || proofUploading || !proofReady} onClick={()=>onSubmitText(day.key, proofUrl)} className="bb-pressable"
                style={{...s.completeBtn,background:(submitLocked?"rgba(255,255,255,0.04)":proofReady?"#B8FF4D":"rgba(255,255,255,0.05)"),color:submitLocked?"#7CFFB2":proofReady?"#06070D":"#4A5066",cursor:submitLocked||!proofReady?"default":"pointer"}}>
                {completion?.status==="approved"?<><Check size={15}/> approved</>:completion?.status==="pending"?"submitted — awaiting review":completion?.status==="rejected"?"resubmit":"submit proof"}
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

  const submitText=async(key,proofUrl)=>{ const ck=tKey(key,currentPlayer); const upd={...completions,[ck]:{status:"pending",type:"proof",proofUrl,submittedAt:new Date().toISOString()}}; setCompletions(upd); await storeSet("completions",upd); };
  const submitNumeric=async(key,amount,proofUrl)=>{ const ck=tKey(key,currentPlayer); const upd={...completions,[ck]:{status:"pending",type:"numeric",amount,proofUrl,submittedAt:new Date().toISOString()}}; setCompletions(upd); await storeSet("completions",upd); };

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={s.sectionLabel}>daily training</div>
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
  const [proofPreview,setProofPreview]=useState(null);
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
      const pointsMult = isEventActive("double_points") ? 2 : 1;
      await storeSet("points",{...pts,[pid]:(pts[pid]||0)+15*pointsMult});
   const pxp=await storeGet("pass_xp")||{};
      const activeBoosts=await storeGet("pass_active_boosts")||{};
      const mult=getActiveBoostMultiplier(pid,activeBoosts);
      const eventMult = isEventActive("double_xp") ? 2 : 1;
      const updXP={...pxp,[pid]:(pxp[pid]||0)+20*mult*eventMult};
      setPassXP(updXP); await storeSet("pass_xp",updXP);
    }
    setNoteDraft((d)=>{ const n={...d}; delete n[key]; return n; });
  };
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {proofPreview && (
        <div onClick={()=>setProofPreview(null)} style={{position:"fixed",inset:0,zIndex:800,background:"rgba(4,8,24,0.94)",display:"flex",alignItems:"center",justifyContent:"center",padding:18,animation:"chatFadeIn .18s ease"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:430,background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(167,139,250,0.28)",borderRadius:22,padding:14,boxShadow:"0 20px 60px rgba(0,0,0,0.35)",animation:"scaleFadeIn .22s cubic-bezier(.2,.8,.2,1)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:11,color:"#A78BFA",fontWeight:900,letterSpacing:1}}>TRAINING PROOF</div>
              <button onClick={()=>setProofPreview(null)} className="bb-pressable" style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:10,width:34,height:34,color:"#8B92A8",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><X size={17}/></button>
            </div>
            {proofPreview.isVideo ? (
              <video src={proofPreview.url} controls playsInline style={{width:"100%",maxHeight:"70vh",borderRadius:16,background:"#05060C",objectFit:"contain"}}/>
            ) : (
              <img src={proofPreview.url} alt="training proof" style={{width:"100%",maxHeight:"70vh",borderRadius:16,background:"#05060C",objectFit:"contain"}}/>
            )}
          </div>
        </div>
      )}
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
              {item.completion.type==="numeric"&&<div style={s.verifyAmount}>target <span style={{color:"#B8FF4D",fontWeight:700}}>{item.training?.targetAmount}</span> {item.training?.unit||"reps"}</div>}
              {item.completion.proofUrl&&<button onClick={()=>setProofPreview({url:item.completion.proofUrl,isVideo:/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(item.completion.proofUrl)})} className="bb-pressable" style={{display:"block",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:10,padding:"8px 10px",fontSize:12,color:"#A78BFA",fontWeight:800,marginBottom:8,cursor:"pointer",width:"100%",textAlign:"center"}}>open proof in app</button>}
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
        </>
      )}
    </div>
  );
}

// ===================== Chat Tab =====================
const REACTION_EMOJIS = ["🐐","💩","😕","🤓","🌬️","🥀","🤣","😎","🫩","😭","🙉","😈"];
function seededShuffle(arr, seed) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(seed) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
          
function SwipeToast({ toast, onDismiss, onDismissAll }) {
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startY = useRef(0);

const dismiss = () => {
  setLeaving(true);
  setTimeout(onDismiss, 300);
};
const dismissAll = () => {
  setLeaving(true);
  setTimeout(onDismissAll, 300);
};

  return (
    <div
      onTouchStart={(e)=>{ startY.current = e.touches[0].clientY; }}
      onTouchMove={(e)=>{ const dy = e.touches[0].clientY - startY.current; if (dy < 0) setOffset(dy); }}
      onTouchEnd={()=>{ if (offset < -40) dismissAll(); else setOffset(0); }}
      style={{
        background:"#1A1D2E",
        border:"1px solid rgba(184,255,77,0.25)",
        borderRadius:13,
        padding:"12px 16px",
        display:"flex",
        alignItems:"center",
        gap:10,
        boxShadow:"0 8px 32px rgba(0,0,0,0.4)",
        animation: leaving ? "dropUp .3s cubic-bezier(.2,.8,.2,1) forwards" : "dropDown .4s cubic-bezier(.2,.8,.2,1)",
        transform:`translateY(${offset}px)`,
        opacity: leaving ? 0 : Math.max(0,1+offset/100),
        transition: offset===0 ? "transform .3s ease, opacity .3s ease" : "none",
        pointerEvents:"auto",
      }}>
      <span style={{fontSize:18}}>{toast.icon}</span>
      <span style={{fontSize:13,fontWeight:600,color:"#E8ECF4"}}>{toast.text}</span>
    </div>
  );
}        
          
function ChatMessage({ msg, isMe, onReact }) {
  const player = PLAYERS.find((p) => p.id === msg.playerId);
  const [showPicker, setShowPicker] = useState(false);
  const pressTimer = useRef(null);
const handleTouchStart = () => { pressTimer.current = setTimeout(() => setShowPicker(true), 500); };
const handleTouchEnd = () => { clearTimeout(pressTimer.current); };
const handleMouseDown = () => { pressTimer.current = setTimeout(() => setShowPicker(true), 500); };
const handleMouseUp = () => { clearTimeout(pressTimer.current); };
  const reactionCounts = {};
  const myReactions = new Set();
  (msg.reactions || []).forEach(r => {
    reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
  });
  (msg.reactions || []).filter(r => r.playerId === (isMe ? msg.playerId : undefined)).forEach(r => myReactions.add(r.emoji));
  const existingReactions = Object.keys(reactionCounts);
  const msgSeed = msg.id ? parseInt(msg.id.slice(-6), 10) || 42 : 42;
  const shuffledEmojis = seededShuffle(REACTION_EMOJIS, msgSeed);
  return (
    <div style={{ ...s.chatMsgRow, justifyContent: isMe ? "flex-end" : "flex-start", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
      {showPicker && (
        <div style={{ display: "flex", gap: 6, background: "#1A1D2E", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22, padding: "6px 10px", marginBottom: 6, flexWrap: "wrap", maxWidth: 260, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", zIndex: 10 }}>
          {shuffledEmojis.map(emoji => (
            <button key={emoji} onClick={() => { onReact(msg.id, emoji); setShowReactPicker(false); }}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", padding: "2px 3px", borderRadius: 8, lineHeight: 1 }}>
              {emoji}
            </button>
          ))}
        <button onClick={() => setShowPicker(false)} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#8B92A8", fontSize: 17, cursor: "pointer", padding: "4px 8px", borderRadius: 8, lineHeight: 1, minWidth: 32, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>
      )}
     <div
  style={{ ...s.chatBubble, background: isMe ? "#B8FF4D" : "#161927", color: isMe ? "#06070D" : "#E8ECF4", userSelect: "none" }}
  onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
  onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
  onClick={() => { if (showPicker) setShowPicker(false); }}
>
        {!isMe && <div style={{ ...s.chatAuthor, color: player?.color }}>{player?.name}</div>}
        <div style={s.chatText}>{msg.text}</div>
        <div style={{ ...s.chatTime, color: isMe ? "rgba(6,7,13,0.5)" : "#4A5066" }}>{new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
      </div>
      {existingReactions.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          {existingReactions.map(emoji => (
            <button key={emoji} onClick={() => onReact(msg.id, emoji)}
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 99, padding: "2px 8px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: "#E8ECF4" }}>
              {emoji} <span style={{ fontSize: 11, color: "#8B92A8" }}>{reactionCounts[emoji]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
          
          
function VoiceRoom({ currentPlayer, addToast, headerOnly, points, autoJoinNonce }) {
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState({});
              
const [voicePresence, setVoicePresence] = useState({});              
  const [muted, setMuted] = useState(false);
  const [callObject, setCallObject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [speakingMap, setSpeakingMap] = useState({});          
  const remoteAudioRef = useRef(null);
const remoteStreamRef = useRef(null);
const speakingUntilRef = useRef({});
const activeSpeakerIdsRef = useRef([]);
const speakingAnalyzersRef = useRef({});
const audioContextRef = useRef(null);
const [voiceVolume, setVoiceVolume] = useState(100);
  const playerObj = PLAYERS.find(p => p.id === currentPlayer);

  const getRemoteStream = () => {
    if (!remoteStreamRef.current && typeof MediaStream !== "undefined") {
      remoteStreamRef.current = new MediaStream();
    }
    return remoteStreamRef.current;
  };

  const getParticipantIds = (dp) => [dp?.session_id, dp?.id, dp?.user_id, dp?.peerId].filter(Boolean);
  const getParticipantAudioLevel = (dp) => {
    const raw = dp?.audioLevel ?? dp?.audio_level ?? dp?.audio_level_average ?? dp?.tracks?.audio?.audioLevel ?? 0;
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  };

  const markSpeaking = (dpOrIds, duration = 900) => {
    const ids = Array.isArray(dpOrIds) ? dpOrIds.filter(Boolean) : getParticipantIds(dpOrIds);
    if (!ids.length) return;
    const until = Date.now() + duration;
    ids.forEach(id => { speakingUntilRef.current[id] = until; });
    activeSpeakerIdsRef.current = ids;
    const active = Object.fromEntries(Object.entries(speakingUntilRef.current).filter(([_, exp]) => exp > Date.now()).map(([id]) => [id, true]));
    setSpeakingMap(active);
  };

  const getAudioContext = async () => {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === "suspended") {
      try { await audioContextRef.current.resume(); } catch (_) {}
    }
    return audioContextRef.current;
  };

  const stopSpeakingAnalyzer = (key) => {
    const item = speakingAnalyzersRef.current[key];
    if (!item) return;
    item.active = false;
    try { item.source?.disconnect?.(); } catch (_) {}
    delete speakingAnalyzersRef.current[key];
  };

  const stopParticipantAnalyzers = (dp) => {
    const ids = getParticipantIds(dp);
    ids.forEach(stopSpeakingAnalyzer);
  };

  const startSpeakingAnalyzer = async (dp, track) => {
    if (!dp || !track || track.kind !== "audio") return;
    const ids = getParticipantIds(dp);
    const key = ids[0];
    if (!key) return;
    const existing = speakingAnalyzersRef.current[key];
    if (existing?.trackId === track.id) return;
    stopSpeakingAnalyzer(key);
    const ctx = await getAudioContext();
    if (!ctx) return;
    try {
      const stream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const item = { active:true, source, analyser, data, trackId:track.id };
      speakingAnalyzersRef.current[key] = item;
      const tick = () => {
        if (!item.active || track.readyState === "ended") { stopSpeakingAnalyzer(key); return; }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i=0; i<data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const latest = (callObject || window.__bbDailyCallObject)?.participants?.() || participants;
        const freshDp = ids.map(id => latest?.[id]).find(Boolean) || dp;
        if (freshDp?.audio !== false && rms > 0.025) {
          markSpeaking(freshDp, 700);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      track.addEventListener?.("ended", () => stopSpeakingAnalyzer(key), { once:true });
    } catch (_) {}
  };

  // Load Daily SDK dynamically
  useEffect(() => {
    if (window.DailyIframe) return;
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@daily-co/daily-js";
    script.async = true;
    document.head.appendChild(script);
    return () => {};
  }, []);

  // Keep the same Daily call alive when switching tabs so audio does not restart.
  useEffect(() => {
    const existing = window.__bbDailyCallObject;
    if (!existing || callObject) return;
    try {
      setCallObject(existing);
      setJoined(true);
      setParticipants(existing.participants?.() || {});
      setMuted(existing.localAudio ? !existing.localAudio() : false);
      setError(null);
    } catch (err) {
      try { existing.destroy?.(); } catch (_) {}
      delete window.__bbDailyCallObject;
    }
  }, []);

              
useEffect(() => {
  let alive = true;

  const loadVoicePresence = async () => {
  const vp = await storeGet("voice_presence") || {};
    const cutoff = Date.now() - 45 * 1000;

    const cleaned = Object.fromEntries(
      Object.entries(vp).filter(([_, v]) => new Date(v.ts).getTime() > cutoff)
    );

    if (alive) setVoicePresence(cleaned);
  };

  loadVoicePresence();
  const timer = setInterval(loadVoicePresence, 5000);

  return () => {
    alive = false;
    clearInterval(timer);
  };
}, []);              
              
              
  useEffect(() => {
  if (!joined || !currentPlayer) return;

  const writePresence = async () => {
    const vp = await storeGet("voice_presence") || {};
    const updatedPresence = {
      ...vp,
      [currentPlayer]: {
        playerId: currentPlayer,
        name: playerObj?.name || currentPlayer,
        ts: new Date().toISOString()
      }
    };

    await storeSet("voice_presence", updatedPresence);
    setVoicePresence(updatedPresence);
  };

  writePresence();
  const timer = setInterval(writePresence, 15000);

  return () => clearInterval(timer);
}, [joined, currentPlayer]);            
              
              
              
  const joinRoom = async () => {
    if (!window.DailyIframe) {
      setError("voice SDK still loading — try again in a second");
      return;
    }

    const existing = callObject || window.__bbDailyCallObject;
    if (existing) {
      try {
        const state = existing.meetingState?.();
        const canReuse = !state || state === "joined-meeting" || state === "joining-meeting";
        if (canReuse) {
          setCallObject(existing);
          setParticipants(existing.participants?.() || {});
          setJoined(true);
          setMuted(existing.localAudio ? !existing.localAudio() : false);
          setError(null);
          return;
        }
        try { existing.destroy?.(); } catch (_) {}
        delete window.__bbDailyCallObject;
        setCallObject(null);
      } catch (err) {
        try { existing.destroy?.(); } catch (_) {}
        delete window.__bbDailyCallObject;
        setCallObject(null);
      }
    }

    setLoading(true);
    setError(null);
try {
const micTestStream = await navigator.mediaDevices.getUserMedia({
  audio: {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  channelCount: 1,
},
  video: false,
});
micTestStream.getTracks().forEach(t => t.stop());

    
const co = window.DailyIframe.createCallObject({
  audioSource: true,
  videoSource: false,
  subscribeToTracksAutomatically: true,
  dailyConfig: {
    prejoinUI: false,
  },
});

window.__bbDailyCallObject = co;

   co.on("participant-joined", (e) => {
  setParticipants(prev => ({ ...prev, [e.participant.session_id]: e.participant }));
  if (!e.participant.local) {
    addToast(`${e.participant.user_name} joined voice`, "🎙️");
  }
});
   co.on("participant-updated", (e) => {
  setParticipants(prev => ({ ...prev, [e.participant.session_id]: e.participant }));
  if (e.participant?.local) setMuted(!e.participant.audio);
  const persistentTrack = e.participant?.tracks?.audio?.persistentTrack || e.participant?.tracks?.audio?.track;
  if (persistentTrack) startSpeakingAnalyzer(e.participant, persistentTrack);
  if (e.participant?.audio !== false && getParticipantAudioLevel(e.participant) > 0.015) markSpeaking(e.participant, 950);

});
    
    co.on("track-started", (e) => {
  if (e.track?.kind !== "audio") return;
  startSpeakingAnalyzer(e.participant, e.track);
  if (e.participant?.local) return;

  const remoteStream = getRemoteStream();
  if (!remoteStream) return;
  if (!remoteStream.getTracks().some(t => t.id === e.track.id)) {
    remoteStream.addTrack(e.track);
  }

  if (remoteAudioRef.current) {
    remoteAudioRef.current.srcObject = remoteStream;
    remoteAudioRef.current.muted = false;
    remoteAudioRef.current.volume = Math.max(0, Math.min(1, Number(voiceVolume || 100) / 100));
    remoteAudioRef.current.play().catch(console.error);
  }
});
    co.on("track-stopped", (e) => {
  if (e.track?.kind === "audio") stopParticipantAnalyzers(e.participant);
});
    
    
      co.on("participant-left", (e) => {
        stopParticipantAnalyzers(e.participant);
        setParticipants(prev => {
          const next = { ...prev };
          delete next[e.participant.session_id];
          return next;
        });
      });
co.on("active-speaker-change", (e) => {
  const active = e?.activeSpeaker;
  const ids = [
    active?.peerId,
    active?.session_id,
    active?.id,
    active?.user_id,
    typeof active === "string" ? active : null,
  ].filter(Boolean);
  if (!ids.length) {
    activeSpeakerIdsRef.current = [];
    return;
  }
  activeSpeakerIdsRef.current = ids;
  markSpeaking(ids, 1200);
  try { setParticipants(co.participants?.() || {}); } catch (_) {}
});
      co.on("error", (e) => {
        const msg = String(e?.errorMsg || e?.message || e || "").toLowerCase();
        if (msg.includes("duplicate") && msg.includes("daily")) {
          setError(null);
          setLoading(false);
          return;
        }
        setError("connection error — check mic permissions");
        setLoading(false);
      });

  await co.join({
  url: "https://theburtonbattlers.daily.co/burton-battlers",
  userName: playerObj?.name || currentPlayer,
  startVideoOff: true,
  startAudioOff: false,
});
    
      

await co.setLocalAudio(true);   
    
window.__bbDailyCallObject = co;
setParticipants(co.participants());
    
      setCallObject(co);
    setMuted(false);
    setJoined(true);

const vp = await storeGet("voice_presence") || {};
const updatedPresence = {
  ...vp,
  [currentPlayer]: {
    playerId: currentPlayer,
    name: playerObj?.name || currentPlayer,
    ts: new Date().toISOString()
  }
};

await storeSet("voice_presence", updatedPresence);
setVoicePresence(updatedPresence);

setLoading(false);
      addToast?.(`${playerObj?.name} joined voice`, "🎙️");
} catch (e) {
  console.error(e);
  const msg = String(e?.message || e || "").toLowerCase();
  if (msg.includes("duplicate") && msg.includes("daily") && window.__bbDailyCallObject) {
    const existing = window.__bbDailyCallObject;
    setCallObject(existing);
    setParticipants(existing.participants?.() || {});
    setJoined(true);
    setMuted(existing.localAudio ? !existing.localAudio() : false);
    setError(null);
  } else {
    setError(e.message);
  }
  setLoading(false);
}
  };

  useEffect(() => {
    if (!autoJoinNonce || joined || loading) return;
    joinRoom();
  }, [autoJoinNonce]);

  const leaveRoom = async () => {
    if (callObject) {
      await callObject.leave();
      callObject.destroy();
      if (window.__bbDailyCallObject === callObject) delete window.__bbDailyCallObject;
      setCallObject(null);
    }
    try {
      Object.keys(speakingAnalyzersRef.current).forEach(stopSpeakingAnalyzer);
      if (audioContextRef.current?.state !== "closed") audioContextRef.current?.close?.();
      audioContextRef.current = null;
      remoteStreamRef.current?.getTracks?.().forEach(t => t.stop());
      remoteStreamRef.current = null;
    } catch (_) {}
const vp = await storeGet("voice_presence") || {};
delete vp[currentPlayer];
await storeSet("voice_presence", vp);
setVoicePresence(vp);

setJoined(false);
setParticipants({});
setSpeakingMap({});
speakingUntilRef.current = {};
setMuted(false);
setLoading(false);
setError(null);
  };

  const toggleMute = async () => {
    const co = callObject || window.__bbDailyCallObject;
    if (!co) return;
    const newMuted = !muted;
    setMuted(newMuted);
    await co.setLocalAudio(!newMuted);
    setTimeout(() => {
      try {
        setParticipants(co.participants?.() || {});
        setMuted(co.localAudio ? !co.localAudio() : newMuted);
      } catch (_) {}
    }, 80);
  };

  // Map daily participant names back to our players
  const getPlayerForName = (name) => PLAYERS.find(p => p.name === name);
  const getVoiceIcon = (pid) => {
    const owned = points?.[pid + "_owned"] || [];
    const equipped = points?.[pid + "_equipped"] || {};
    const iconId = owned.find(id => equipped[id] && (SHOP_ITEMS.find(i => i.id === id)?.type === "icon" || (id.startsWith("pass_") && getPassRewardForOwnedId(id)?.type === "icon")));
    if (!iconId) return null;
    return SHOP_ITEMS.find(i => i.id === iconId)?.value || getPassRewardForOwnedId(iconId)?.value || null;
  };

  useEffect(() => {
    if (!joined) return;
    const timer = setInterval(() => {
      const co = callObject || window.__bbDailyCallObject;
      if (!co) return;
      try {
        const latest = co.participants?.() || {};
        const now = Date.now();
        Object.values(latest).forEach(dp => {
          const persistentTrack = dp?.tracks?.audio?.persistentTrack || dp?.tracks?.audio?.track;
          if (persistentTrack) startSpeakingAnalyzer(dp, persistentTrack);
          if (dp?.audio !== false && getParticipantAudioLevel(dp) > 0.012) {
            getParticipantIds(dp).forEach(id => { speakingUntilRef.current[id] = now + 950; });
          }
        });
        const activeSpeaking = Object.fromEntries(
          Object.entries(speakingUntilRef.current)
            .filter(([_, exp]) => exp > now)
            .map(([id]) => [id, true])
        );
        speakingUntilRef.current = Object.fromEntries(Object.entries(speakingUntilRef.current).filter(([_, exp]) => exp > now));
        setSpeakingMap(activeSpeaking);
        setParticipants(latest);
        setMuted(co.localAudio ? !co.localAudio() : muted);
      } catch (_) {}
    }, 180);
    return () => clearInterval(timer);
  }, [joined, callObject, muted]);

  const participantList = Object.values(participants);
  const localParticipant = participantList.find(p => p.local);
  const remoteParticipants = participantList.filter(p => !p.local);
  const isParticipantSpeaking = (dp) => !!(dp && (
    speakingMap[dp.session_id] ||
    speakingMap[dp.id] ||
    speakingMap[dp.user_id] ||
    speakingMap[dp.peerId]
  ));
  const speakingParticipant = participantList.find(dp => !dp.local && isParticipantSpeaking(dp)) || participantList.find(dp => isParticipantSpeaking(dp));
  const speakingPlayer = speakingParticipant ? getPlayerForName(speakingParticipant.user_name) : null;

  useEffect(() => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.volume = Math.max(0, Math.min(1, Number(voiceVolume || 100) / 100));
  }, [voiceVolume]);

  if (!joined) {
    return (
      <div style={{
        background:"linear-gradient(135deg,#080F08,#06070D)",
        border:"1px solid rgba(184,255,77,0.25)",
        borderRadius:16,
        padding:18,
        marginBottom:10,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#B8FF4D",boxShadow:"0 0 8px #B8FF4D99"}}/>
          <div style={{fontSize:11,color:"#B8FF4D",fontWeight:700,letterSpacing:0.8}}>VOICE ROOM</div>
        </div>

        {/* Player dots showing who could join */}
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          {PLAYERS.map(p => {
            const inVoice = !!voicePresence[p.id];
            return (
            <div key={p.id} style={{flex:1,background:inVoice?`${p.color}10`:"rgba(255,255,255,0.03)",borderRadius:12,padding:"12px 8px",textAlign:"center",border:`1px solid ${inVoice?p.color+"66":p.color+"22"}`}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:`${p.color}22`,border:`2px solid ${inVoice?p.color:p.color+"44"}`,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:inVoice?`0 0 12px ${p.color}55`:"none"}}>
                {getVoiceIcon(p.id) || "🎙️"}
              </div>
              <div style={{fontSize:10,fontWeight:700,color:p.color}}>{p.name}</div>
              <div style={{fontSize:9,color:inVoice?"#7CFFB2":"#4A5066",marginTop:2}}>{inVoice?"in voice room":"not in room"}</div>
            </div>
          );})}
        </div>

        {error && (
          <div style={{background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:12,color:"#FF5C8A"}}>
            {error}
          </div>
        )}

        <button
onClick={async () => {
  if (loading || joined) return;
  await joinRoom();
}}
          disabled={loading}
          className="bb-pressable bb-glow-lime"
          style={{
            width:"100%",
            background: loading ? "rgba(255,255,255,0.05)" : "#B8FF4D",
            border:"none",
            borderRadius:12,
            padding:"14px 0",
            fontSize:14,
            fontWeight:700,
            color: loading ? "#4A5066" : "#06070D",
            cursor: loading ? "default" : "pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            gap:8,
          }}>
          {loading ? (
            <>
              <div style={{width:14,height:14,borderRadius:"50%",border:"2px solid rgba(255,255,255,0.2)",borderTopColor:"#fff",animation:"spin .7s linear infinite"}}/>
              connecting…
            </>
          ) : "🎙️ join voice room"}
        </button>
        <div style={{fontSize:10,color:"#3A4256",textAlign:"center",marginTop:8}}>
          microphone required · audio only · no video
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background:"linear-gradient(135deg,#080F08,#06070D)",
      border:"1px solid rgba(184,255,77,0.4)",
      borderRadius:16,
      padding:18,
      marginBottom:10,
      boxShadow:"0 0 24px rgba(184,255,77,0.08)",
    }}>
<audio
  ref={remoteAudioRef}
  autoPlay
  playsInline
  style={{ display: "none" }}
/>

{/* Header */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
  <div style={{display:"flex",alignItems:"center",gap:8}}>
    <div className="bb-live-dot" style={{width:8,height:8,borderRadius:"50%",background:"#B8FF4D",boxShadow:"0 0 8px #B8FF4D99"}} />
    <div style={{fontSize:11,color:"#B8FF4D",fontWeight:700,letterSpacing:0.8}}>
      LIVE VOICE ROOM
    </div>
  </div>

  <div style={{fontSize:10,color:"#4A5066"}}>
    {participantList.length} connected
  </div>
</div>

      {speakingPlayer && (
        <div style={{background:`${speakingPlayer.color}14`,border:`1px solid ${speakingPlayer.color}55`,borderRadius:13,padding:"10px 12px",marginBottom:14,display:"flex",alignItems:"center",gap:9,boxShadow:`0 0 18px ${speakingPlayer.color}22`}}>
          <div style={{width:9,height:9,borderRadius:99,background:speakingPlayer.color,boxShadow:`0 0 10px ${speakingPlayer.color}`,animation:"livePulse 1s ease-in-out infinite"}} />
          <div style={{fontSize:12,fontWeight:900,color:speakingPlayer.color}}>{speakingPlayer.name} is speaking</div>
        </div>
      )}

      {/* Participant cards */}
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        {PLAYERS.map(p => {
          const dailyParticipant = participantList.find(dp => dp.user_name === p.name);
          const isConnected = !!dailyParticipant;
          const isMe = p.id === currentPlayer;
          const isSpeaking = dailyParticipant && isParticipantSpeaking(dailyParticipant);
          const isMutedParticipant = isMe ? muted : (dailyParticipant ? !dailyParticipant.audio : false);

          return (
            <div key={p.id} style={{
              flex:1,
              background: isConnected ? `${p.color}12` : "rgba(255,255,255,0.02)",
              borderRadius:14,
              padding:"14px 8px",
              textAlign:"center",
              border:`2px solid ${isSpeaking ? p.color : isConnected ? `${p.color}44` : "rgba(255,255,255,0.05)"}`,
              boxShadow: isSpeaking ? `0 0 16px ${p.color}44` : "none",
              transition:"all .2s ease",
              position:"relative",
            }}>
              {/* Speaking ring animation */}
              {isSpeaking && (
                <div style={{
                  position:"absolute",
                  inset:-4,
                  borderRadius:18,
                  border:`2px solid ${p.color}`,
                  animation:"livePulse 1s ease-in-out infinite",
                  pointerEvents:"none",
                }}/>
              )}

              {/* Avatar */}
              <div style={{
                width:44,
                height:44,
                borderRadius:"50%",
                background: isConnected ? `${p.color}33` : "rgba(255,255,255,0.04)",
                border:`2px solid ${isConnected ? p.color : "rgba(255,255,255,0.08)"}`,
                margin:"0 auto 10px",
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                fontSize:20,
                boxShadow: isConnected ? `0 0 12px ${p.color}66` : "none",
              }}>
                {isConnected ? (getVoiceIcon(p.id) || (isMutedParticipant ? "🔇" : isSpeaking ? "🗣️" : "🎙️")) : (voicePresence[p.id] ? (getVoiceIcon(p.id) || "🎙️") : "💤")}
              </div>

              <div style={{fontSize:11,fontWeight:700,color:isConnected ? p.color : "#4A5066"}}>{p.name}</div>
              <div style={{fontSize:9,marginTop:3,color:
                isSpeaking ? p.color :
                isMutedParticipant ? "#FF5C8A" :
                isConnected ? "#7CFFB2" :
                "#3A4256"
              }}>
                {isConnected
  ? isMutedParticipant
    ? "muted"
    : "listening"
  : voicePresence[p.id] ? "in voice" : "not in room"}
              </div>

              {isMe && isConnected && (
                <div style={{fontSize:8,color:"#B8FF4D",fontWeight:700,marginTop:4,background:"rgba(184,255,77,0.1)",padding:"2px 6px",borderRadius:99,display:"inline-block"}}>
                  YOU
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:13,padding:"11px 12px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:7}}>
          <div style={{fontSize:10,color:"#8B92A8",fontWeight:900,letterSpacing:.7,textTransform:"uppercase"}}>teammate voice volume</div>
          <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900}}>{voiceVolume}%</div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={voiceVolume}
          onChange={(e)=>setVoiceVolume(Number(e.target.value))}
          style={{width:"100%",accentColor:"#B8FF4D"}}
        />
      </div>

      {/* Controls */}
      <div style={{display:"flex",gap:10}}>
        <button
          onClick={toggleMute}
          className="bb-pressable"
          style={{
            flex:1,
            background: muted ? "rgba(255,92,138,0.15)" : "rgba(184,255,77,0.12)",
            border:`1px solid ${muted ? "rgba(255,92,138,0.4)" : "rgba(184,255,77,0.35)"}`,
            borderRadius:12,
            padding:"13px 0",
            fontSize:13,
            fontWeight:700,
            color: muted ? "#FF5C8A" : "#B8FF4D",
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            gap:6,
          }}>
          {muted ? "🔇 unmute" : "🎙️ mute"}
        </button>

        <button
          onClick={leaveRoom}
          className="bb-pressable"
          style={{
            flex:1,
            background:"rgba(255,92,138,0.1)",
            border:"1px solid rgba(255,92,138,0.3)",
            borderRadius:12,
            padding:"13px 0",
            fontSize:13,
            fontWeight:700,
            color:"#FF5C8A",
            cursor:"pointer",
          }}>
          📵 leave
        </button>
      </div>

    </div>
  );
}          
          
          


function TeamSessionPlanner({ currentPlayer, teamSessions, setTeamSessions, pings, setPings, addToast }) {
  const [minutes, setMinutes] = useState(30);
  const player = PLAYERS.find(p => p.id === currentPlayer);
  const now = Date.now();
  const openSessions = (teamSessions || [])
    .filter(s => !s.cancelled && new Date(s.startsAt).getTime() > now - 2 * 60 * 60 * 1000)
    .sort((a,b) => new Date(a.startsAt) - new Date(b.startsAt));

  const makeSessionPings = (session, targets) => targets.map((pid, idx) => ({
    id: `${session.id}_ping_${pid}_${Date.now()+idx}`,
    from: currentPlayer,
    to: pid,
    ts: new Date().toISOString(),
    type: "session",
    mode: session.mode,
    sessionId: session.id,
    startsAt: session.startsAt,
    minutesUntil: Math.max(0, Math.round((new Date(session.startsAt).getTime() - Date.now()) / 60000)),
  }));

  const sendPings = async (session, targetIds) => {
    const targets = targetIds.filter(pid => pid && pid !== currentPlayer);
    if (!targets.length) return;
    const freshPings = await storeGet("pings") || [];
    const newPings = makeSessionPings(session, targets);
    const upd = [...freshPings, ...newPings].slice(-120);
    setPings(upd);
    await storeSet("pings", upd);
    addToast?.(`session ping sent to ${targets.length === 1 ? PLAYERS.find(p=>p.id===targets[0])?.name : "everyone"}`, "⏱️");
  };

  const createSession = async () => {
    const mins = Math.max(5, Math.min(180, Number(minutes) || 30));
    const startsAt = new Date(Date.now() + mins * 60000).toISOString();
    const session = {
      id: Date.now().toString(),
      mode: "3v3",
      createdBy: currentPlayer,
      createdByName: player?.name || currentPlayer,
      createdAt: new Date().toISOString(),
      startsAt,
      responses: { [currentPlayer]: "accepted" },
    };
    const upd = [session, ...(teamSessions || []).filter(s => !s.cancelled)].slice(0, 10);
    setTeamSessions(upd);
    await storeSet("team_sessions", upd);
    await sendPings(session, PLAYERS.map(p => p.id).filter(pid => pid !== currentPlayer));
    addToast?.(`3v3 session set for ${mins} min`, "⏱️");
  };

  const acceptSession = async (session) => {
    const upd = (teamSessions || []).map(s => s.id === session.id
      ? { ...s, responses: { ...(s.responses || {}), [currentPlayer]: "accepted" } }
      : s
    );
    setTeamSessions(upd);
    await storeSet("team_sessions", upd);
    const freshPings = (await storeGet("pings") || []).filter(p => !(p.type === "session" && p.sessionId === session.id && p.to === currentPlayer));
    setPings(freshPings);
    await storeSet("pings", freshPings);
    addToast?.("session accepted", "✅");
  };

  const cancelSession = async (session) => {
    const upd = (teamSessions || []).map(s => s.id === session.id ? { ...s, cancelled: true, cancelledAt: new Date().toISOString() } : s);
    setTeamSessions(upd);
    await storeSet("team_sessions", upd);
    addToast?.("session cancelled", "❌");
  };

  return (
    <div style={{background:"linear-gradient(135deg,#101421,#080A12)",border:"1px solid rgba(167,139,250,0.18)",borderRadius:16,padding:16,marginTop:14,boxShadow:"0 0 22px rgba(0,0,0,0.2)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:"#A78BFA",fontWeight:900,letterSpacing:.9}}>3V3 SESSION</div>
          <div style={{fontSize:11,color:"#6F7892",marginTop:2}}>schedule and ping the squad</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <input value={minutes} onChange={(e)=>setMinutes(e.target.value)} inputMode="numeric" style={{width:56,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"8px 9px",color:"#E8ECF4",fontSize:12,fontWeight:800,textAlign:"center"}} />
          <div style={{fontSize:10,color:"#6F7892",fontWeight:800}}>min</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[15,30,45,60].map(m => (
          <button key={m} onClick={()=>setMinutes(m)} className="bb-pressable" style={{flex:1,background:Number(minutes)===m?"#A78BFA":"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"8px 0",fontSize:11,fontWeight:900,color:Number(minutes)===m?"#06070D":"#8B92A8",cursor:"pointer"}}>
            {m}
          </button>
        ))}
      </div>
      <button onClick={createSession} className="bb-pressable bb-glow-violet" style={{width:"100%",background:"#A78BFA",border:"none",borderRadius:12,padding:"12px 0",fontSize:13,fontWeight:900,color:"#06070D",cursor:"pointer",marginBottom:14}}>
        ping squad for 3v3
      </button>

      {openSessions.length === 0 ? (
        <div style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:12,fontSize:12,color:"#6F7892",textAlign:"center"}}>no planned session yet</div>
      ) : openSessions.slice(0,3).map(session => {
        const minsLeft = Math.round((new Date(session.startsAt).getTime() - Date.now()) / 60000);
        const accepted = Object.entries(session.responses || {}).filter(([_, v]) => v === "accepted").map(([pid]) => pid);
        const iAccepted = session.responses?.[currentPlayer] === "accepted";
        return (
          <div key={session.id} style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(184,255,77,0.12)",borderRadius:13,padding:12,marginTop:8}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:13,fontWeight:900,color:"#E8ECF4"}}>3v3 {minsLeft > 0 ? `in ${minsLeft} min` : "starting now"}</div>
                <div style={{fontSize:10.5,color:"#6F7892",marginTop:3}}>set by {PLAYERS.find(p=>p.id===session.createdBy)?.name || session.createdByName}</div>
              </div>
              {!iAccepted ? (
                <button onClick={()=>acceptSession(session)} className="bb-pressable bb-glow-lime" style={{background:"#B8FF4D",border:"none",borderRadius:10,padding:"8px 10px",fontSize:11,fontWeight:900,color:"#06070D",cursor:"pointer"}}>accept</button>
              ) : (
                <div style={{fontSize:10,color:"#7CFFB2",fontWeight:900,background:"rgba(124,255,178,0.1)",border:"1px solid rgba(124,255,178,0.2)",borderRadius:99,padding:"6px 9px"}}>you're in</div>
              )}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
              {PLAYERS.map(p => (
                <button key={p.id} onClick={()=>sendPings(session,[p.id])} className="bb-pressable" style={{background:accepted.includes(p.id)?`${p.color}18`:"rgba(255,255,255,0.04)",border:`1px solid ${accepted.includes(p.id)?p.color+"55":"rgba(255,255,255,0.07)"}`,borderRadius:99,padding:"5px 8px",fontSize:10,fontWeight:800,color:accepted.includes(p.id)?p.color:"#8B92A8",cursor:p.id===currentPlayer?"default":"pointer"}}>
                  {accepted.includes(p.id)?"✓ ":"ping "}{p.name}
                </button>
              ))}
            </div>
            {session.createdBy === currentPlayer && (
              <button onClick={()=>cancelSession(session)} className="bb-pressable" style={{marginTop:9,background:"none",border:"none",color:"#FF5C8A",fontSize:10,fontWeight:800,cursor:"pointer"}}>cancel session</button>
            )}
          </div>
        );
      })}
    </div>
  );
}


function RoomMusicPlayer({ currentPlayer, addToast }) {
  const emptyMusicState = { url:"", title:"", dj:null, djName:"", playing:false, positionMs:0, updatedAt:null, queue:[] };
  const [musicState, setMusicState] = useState(emptyMusicState);
  const [trackLink, setTrackLink] = useState("");
  const [requestLink, setRequestLink] = useState("");
  const [joinedMusic, setJoinedMusic] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [musicVolume, setMusicVolume] = useState(42);
  const [playerReady, setPlayerReady] = useState(false);
  const iframeRef = useRef(null);
  const widgetRef = useRef(null);
  const lastAppliedRef = useRef("");
  const applyingRef = useRef(false);

  const player = PLAYERS.find(p => p.id === currentPlayer);
  const isDj = !musicState?.dj || musicState.dj === currentPlayer;
  const queue = Array.isArray(musicState?.queue) ? musicState.queue : [];
  const hasTrack = !!musicState?.url;
  const normalizeSoundCloudUrl = (url) => {
    let raw = String(url || "").trim();
    if (!raw) return "";
    raw = raw.replace(/^soundcloud:\/\//i, "https://soundcloud.com/");
    if (/^(soundcloud\.com|www\.soundcloud\.com|m\.soundcloud\.com|on\.soundcloud\.com|soundcloud\.app\.goo\.gl)\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./i, "").replace(/^m\./i, "").toLowerCase();
      if (["soundcloud.com", "on.soundcloud.com", "soundcloud.app.goo.gl", "api.soundcloud.com"].includes(host)) {
        return `https://${host}${u.pathname}${u.search}`;
      }
    } catch (_) {}
    return raw;
  };
  const isSoundCloudUrl = (url) => {
    try {
      const u = new URL(normalizeSoundCloudUrl(url));
      const host = u.hostname.replace(/^www\./i, "").replace(/^m\./i, "").toLowerCase();
      return ["soundcloud.com", "on.soundcloud.com", "soundcloud.app.goo.gl", "api.soundcloud.com"].includes(host);
    } catch (_) {
      return false;
    }
  };
  const cleanUrl = (url) => normalizeSoundCloudUrl(url);
  const displayTrack = (url) => {
    try {
      const u = new URL(normalizeSoundCloudUrl(url));
      const slug = decodeURIComponent(u.pathname.split("/").filter(Boolean).slice(-1)[0] || u.hostname).replace(/[-_]+/g, " ");
      if (u.hostname.includes("on.soundcloud") || u.hostname.includes("app.goo.gl")) return "mobile SoundCloud link";
      return slug || "SoundCloud track";
    } catch (_) {
      return "SoundCloud track";
    }
  };
  const resolveSoundCloudUrl = async (url) => {
    const normalized = cleanUrl(url);
    try {
      const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(normalized)}`);
      if (!res.ok) throw new Error("oembed failed");
      const data = await res.json();
      const html = String(data?.html || "");
      const match = html.match(/[?&]url=([^&"']+)/);
      return {
        url: match ? decodeURIComponent(match[1]) : normalized,
        title: data?.title || displayTrack(normalized),
      };
    } catch (_) {
      return { url: normalized, title: displayTrack(normalized) };
    }
  };
  const getLivePositionMs = (state = musicState) => {
    const base = Number(state?.positionMs) || 0;
    if (!state?.playing || !state?.updatedAt) return base;
    return Math.max(0, base + (Date.now() - new Date(state.updatedAt).getTime()));
  };
  const embedSrc = hasTrack
    ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(musicState.url)}&auto_play=false&buying=false&liking=false&download=false&sharing=false&show_artwork=false&show_comments=false&show_playcount=false&show_user=false&hide_related=true&visual=false`
    : "";

  const ensureSoundCloudApi = () => new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("window unavailable"));
    if (window.SC?.Widget) return resolve(window.SC.Widget);
    const existing = document.querySelector('script[data-bb-soundcloud="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.SC.Widget), { once:true });
      existing.addEventListener("error", reject, { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.dataset.bbSoundcloud = "true";
    script.onload = () => resolve(window.SC.Widget);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const getWidget = async () => {
    const Widget = await ensureSoundCloudApi();
    if (!iframeRef.current) return null;
    if (!widgetRef.current) {
      widgetRef.current = Widget(iframeRef.current);
      widgetRef.current.bind?.(Widget.Events.READY, () => setPlayerReady(true));
      widgetRef.current.bind?.(Widget.Events.ERROR, () => addToast?.("that SoundCloud track can't be embedded", "⚠️"));
    }
    return widgetRef.current;
  };

  const updateMusicState = async (next) => {
    setMusicState(next);
    await storeSet("room_music", next);
  };

  useEffect(() => {
    let alive = true;
    storeGet("room_music").then(v => {
      if (!alive) return;
      setMusicState(v?.url || v?.queue ? { ...emptyMusicState, ...v, queue:Array.isArray(v.queue)?v.queue:[] } : emptyMusicState);
    });
    const unsub = subscribeKVMulti(["room_music"], ({ value }) => {
      const next = value?.url || value?.queue ? { ...emptyMusicState, ...value, queue:Array.isArray(value.queue)?value.queue:[] } : emptyMusicState;
      setMusicState(next);
    });
    return () => { alive = false; unsub?.(); };
  }, []);

  useEffect(() => {
    widgetRef.current = null;
    setPlayerReady(false);
    lastAppliedRef.current = "";
  }, [musicState?.url]);

  useEffect(() => {
    if (!hasTrack || !iframeRef.current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const widget = await getWidget();
        if (!widget || cancelled) return;
        widget.setVolume?.(Number(musicVolume) || 0);
      } catch (_) {}
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hasTrack, musicState?.url]);

  useEffect(() => {
    if (!joinedMusic || !hasTrack) return;
    let cancelled = false;
    const applyState = async () => {
      const signature = `${musicState.url}|${musicState.playing}|${musicState.updatedAt}|${Math.floor((musicState.positionMs||0)/250)}`;
      if (lastAppliedRef.current === signature || applyingRef.current) return;
      applyingRef.current = true;
      try {
        const widget = await getWidget();
        if (!widget || cancelled) return;
        widget.setVolume?.(Number(musicVolume) || 0);
        const target = getLivePositionMs(musicState);
        widget.seekTo?.(target);
        if (musicState.playing) {
          widget.play?.();
          setTimeout(() => { try { widget.play?.(); } catch (_) {} }, 350);
        } else {
          widget.pause?.();
        }
        lastAppliedRef.current = signature;
      } catch (_) {
        addToast?.("SoundCloud player is still loading", "🎧");
      } finally {
        applyingRef.current = false;
      }
    };
    const t = setTimeout(applyState, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [joinedMusic, hasTrack, musicState?.url, musicState?.playing, musicState?.updatedAt, musicState?.positionMs]);

  useEffect(() => {
    if (!joinedMusic || !widgetRef.current) return;
    try { widgetRef.current.setVolume?.(Number(musicVolume) || 0); } catch (_) {}
  }, [musicVolume, joinedMusic]);

  useEffect(() => {
    if (!joinedMusic || !hasTrack || !musicState.playing) return;
    const timer = setInterval(async () => {
      try {
        const widget = await getWidget();
        if (!widget) return;
        widget.getPosition?.((pos) => {
          const expected = getLivePositionMs(musicState);
          if (Math.abs(Number(pos || 0) - expected) > 3500) {
            widget.seekTo?.(expected);
          }
        });
      } catch (_) {}
    }, 4500);
    return () => clearInterval(timer);
  }, [joinedMusic, hasTrack, musicState?.playing, musicState?.updatedAt, musicState?.positionMs, musicState?.url]);

  const joinMusic = async () => {
    if (!hasTrack) {
      addToast?.("load a SoundCloud track first", "🎧");
      return;
    }
    setJoinedMusic(true);
    try {
      const widget = await getWidget();
      if (!widget) return;
      const target = getLivePositionMs(musicState);

      // Mobile Safari/Chrome will not let a remote DJ click start audio on this phone.
      // This tap unlocks the hidden SoundCloud iframe locally, then room play/pause can follow.
      if (musicState.playing) {
        widget.setVolume?.(Number(musicVolume) || 0);
        widget.seekTo?.(target);
        widget.play?.();
        setTimeout(() => { try { widget.seekTo?.(target); } catch (_) {} }, 90);
        setTimeout(() => { try { widget.play?.(); } catch (_) {} }, 350);
        setAudioUnlocked(true);
        addToast?.(joinedMusic ? "reconnected room music" : "joined room music", "🎧");
      } else {
        widget.setVolume?.(0);
        widget.seekTo?.(target);
        widget.play?.();
        setAudioUnlocked(true);
        setTimeout(() => {
          try {
            widget.pause?.();
            widget.seekTo?.(target);
            widget.setVolume?.(Number(musicVolume) || 0);
          } catch (_) {}
        }, 180);
        addToast?.("room music unlocked — DJ can play now", "🎧");
      }
    } catch (_) {
      addToast?.("tap join music again after the player loads", "🎧");
    }
  };

  const loadTrack = async (urlOverride = null) => {
    const rawUrl = cleanUrl(urlOverride || trackLink);
    if (!isSoundCloudUrl(rawUrl)) {
      addToast?.("paste a SoundCloud link", "⚠️");
      return;
    }
    const resolved = await resolveSoundCloudUrl(rawUrl);
    const url = resolved.url || rawUrl;
    const next = {
      ...emptyMusicState,
      url,
      title: resolved.title || displayTrack(rawUrl),
      dj: currentPlayer,
      djName: player?.name || currentPlayer,
      playing: false,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
      queue: queue.filter(q => q.url !== url && q.url !== rawUrl),
    };
    await updateMusicState(next);
    setTrackLink("");
    addToast?.("SoundCloud track loaded", "🎧");
  };

  const getWidgetPosition = async () => new Promise(async (resolve) => {
    try {
      const widget = await getWidget();
      if (!widget?.getPosition) return resolve(getLivePositionMs(musicState));
      widget.getPosition(pos => resolve(Number(pos) || 0));
    } catch (_) {
      resolve(getLivePositionMs(musicState));
    }
  });

  const togglePlay = async () => {
    if (!isDj || !hasTrack) return;
    const nextPlaying = !musicState.playing;
    if (nextPlaying) {
      setJoinedMusic(true);
      setAudioUnlocked(true);
    }
    let widget = null;
    try {
      widget = await getWidget();
      widget?.setVolume?.(Number(musicVolume) || 0);
    } catch (_) {}
    const pos = joinedMusic ? await getWidgetPosition() : getLivePositionMs(musicState);
    const next = {
      ...musicState,
      playing: nextPlaying,
      positionMs: pos,
      updatedAt: new Date().toISOString(),
      dj: currentPlayer,
      djName: player?.name || currentPlayer,
    };
    await updateMusicState(next);
    if (widget) {
      if (nextPlaying) {
        widget.seekTo?.(pos);
        widget.play?.();
        setTimeout(() => { try { widget.play?.(); } catch (_) {} }, 350);
      } else {
        widget.pause?.();
      }
    }
  };

  const stopMusic = async () => {
    if (!isDj) return;
    const next = { ...musicState, playing:false, positionMs:0, updatedAt:new Date().toISOString() };
    await updateMusicState(next);
    try { widgetRef.current?.pause?.(); widgetRef.current?.seekTo?.(0); } catch (_) {}
  };

  const addRequest = async () => {
    const rawUrl = cleanUrl(requestLink);
    if (!isSoundCloudUrl(rawUrl)) {
      addToast?.("request needs a SoundCloud link", "⚠️");
      return;
    }
    const resolved = await resolveSoundCloudUrl(rawUrl);
    const entry = {
      id: `${Date.now()}_${currentPlayer}`,
      url: resolved.url || rawUrl,
      title: resolved.title || displayTrack(rawUrl),
      requestedBy: currentPlayer,
      requestedByName: player?.name || currentPlayer,
      ts: new Date().toISOString(),
    };
    const next = { ...musicState, queue:[...queue, entry].slice(-12) };
    await updateMusicState(next);
    setRequestLink("");
    addToast?.("track added to queue", "🎧");
  };

  const playQueued = async (entry) => {
    if (!isDj || !entry?.url) return;
    const rawUrl = cleanUrl(entry.url);
    const resolved = await resolveSoundCloudUrl(rawUrl);
    const newDjId = entry.requestedBy || currentPlayer;
    const newDj = PLAYERS.find(p => p.id === newDjId);
    const next = {
      ...emptyMusicState,
      url: resolved.url || rawUrl,
      title: entry.title || resolved.title || displayTrack(rawUrl),
      dj: newDjId,
      djName: entry.requestedByName || newDj?.name || player?.name || currentPlayer,
      playing: true,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
      queue: queue.filter(q => q.id !== entry.id && q.url !== entry.url),
    };
    setJoinedMusic(true);
    setAudioUnlocked(true);
    await updateMusicState(next);
    try {
      const widget = await getWidget();
      widget?.setVolume?.(Number(musicVolume) || 0);
      widget?.seekTo?.(0);
      widget?.play?.();
      setTimeout(() => { try { widget?.play?.(); } catch (_) {} }, 350);
    } catch (_) {}
    addToast?.(`${next.djName} is DJ now`, "🎧");
  };

  const removeQueued = async (entryId) => {
    if (!isDj) return;
    const next = { ...musicState, queue:queue.filter(q => q.id !== entryId) };
    await updateMusicState(next);
  };

  return (
    <div style={{background:"linear-gradient(135deg,#141018,#080A12)",border:"1px solid rgba(255,85,0,0.22)",borderRadius:16,padding:16,marginTop:14,boxShadow:"0 0 24px rgba(255,85,0,0.08)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:"#FF5500",fontWeight:900,letterSpacing:.9}}>ROOM MUSIC</div>
          <div style={{fontSize:11,color:"#8B92A8",marginTop:2}}>DJ BOOTH</div>
        </div>
        <div style={{fontSize:10,color:isDj?"#B8FF4D":"#FF5500",fontWeight:900,background:isDj?"rgba(184,255,77,0.1)":"rgba(255,85,0,0.1)",border:`1px solid ${isDj?"rgba(184,255,77,0.2)":"rgba(255,85,0,0.25)"}`,borderRadius:99,padding:"6px 9px",whiteSpace:"nowrap"}}>
          DJ: {musicState?.djName || player?.name || "open"}
        </div>
      </div>

      {hasTrack ? (
        <>
          <div style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:13,padding:12,marginBottom:10}}>
            <div style={{fontSize:10,color:"#8B92A8",fontWeight:900,letterSpacing:.7,marginBottom:4}}>NOW PLAYING</div>
            <div style={{fontSize:14,color:"#E8ECF4",fontWeight:900,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{musicState.title || displayTrack(musicState.url)}</div>
            <div style={{fontSize:10.5,color:musicState.playing?"#7CFFB2":"#8B92A8",marginTop:4}}>{musicState.playing ? "live from the DJ" : "paused"} · tap join/reconnect on each phone</div>
          </div>
          <div aria-hidden="true" style={{position:"fixed",left:0,bottom:0,width:1,height:1,overflow:"hidden",opacity:0.01,pointerEvents:"none",transform:"scale(0.01)",transformOrigin:"bottom left"}}>
            <iframe
              ref={iframeRef}
              title="SoundCloud room music hidden player"
              width="1"
              height="1"
              scrolling="no"
              frameBorder="no"
              allow="autoplay; encrypted-media"
              src={embedSrc}
              tabIndex={-1}
              style={{border:"none",width:1,height:1,opacity:0.01,pointerEvents:"none"}}
            />
          </div>
          <button onClick={joinMusic} className="bb-pressable bb-glow-lime" style={{width:"100%",background:joinedMusic?"rgba(184,255,77,0.12)":"#B8FF4D",border:joinedMusic?"1px solid rgba(184,255,77,0.32)":"none",borderRadius:12,padding:"12px 0",fontSize:13,fontWeight:900,color:joinedMusic?"#B8FF4D":"#06070D",cursor:"pointer",marginBottom:10}}>
            {joinedMusic ? (audioUnlocked ? "🔊 reconnect audio" : "🔊 unlock audio") : "🎧 join music"}
          </button>
        </>
      ) : (
        <div style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:13,padding:13,fontSize:12,color:"#8B92A8",textAlign:"center",marginBottom:10}}>
          no SoundCloud track loaded yet
        </div>
      )}

      <div style={{background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:13,padding:"11px 12px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:7}}>
          <div style={{fontSize:10,color:"#8B92A8",fontWeight:900,letterSpacing:.7,textTransform:"uppercase"}}>music volume</div>
          <div style={{fontSize:10,color:"#FF5500",fontWeight:900}}>{musicVolume}%</div>
        </div>
        <input type="range" min="0" max="100" value={musicVolume} onChange={(e)=>setMusicVolume(Number(e.target.value))} style={{width:"100%",accentColor:"#FF5500"}} />
      </div>

      {isDj && (
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <input
            value={trackLink}
            onChange={(e)=>setTrackLink(e.target.value)}
            onKeyDown={(e)=>e.key === "Enter" && loadTrack()}
            placeholder="DJ paste SoundCloud link..."
            style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:11,padding:"11px 12px",fontSize:12,color:"#E8ECF4",minWidth:0}}
          />
          <button onClick={()=>loadTrack()} className="bb-pressable" style={{background:"#FF5500",border:"none",borderRadius:11,padding:"0 12px",fontSize:11,fontWeight:900,color:"#06070D",cursor:"pointer"}}>load</button>
        </div>
      )}

      {hasTrack && isDj && (
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <button onClick={togglePlay} className="bb-pressable" style={{flex:1,background:musicState.playing?"rgba(255,85,0,0.13)":"rgba(184,255,77,0.13)",border:`1px solid ${musicState.playing?"rgba(255,85,0,0.35)":"rgba(184,255,77,0.35)"}`,borderRadius:11,padding:"11px 0",fontSize:12,fontWeight:900,color:musicState.playing?"#FF5500":"#B8FF4D",cursor:"pointer"}}>
            {musicState.playing ? "pause" : "play"}
          </button>
          <button onClick={()=>queue[0] ? playQueued(queue[0]) : addToast?.("queue is empty", "🎧")} className="bb-pressable" style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:11,padding:"11px 0",fontSize:12,fontWeight:900,color:"#E8ECF4",cursor:"pointer"}}>next</button>
          <button onClick={stopMusic} className="bb-pressable" style={{flex:1,background:"rgba(255,92,138,0.09)",border:"1px solid rgba(255,92,138,0.22)",borderRadius:11,padding:"11px 0",fontSize:12,fontWeight:900,color:"#FF5C8A",cursor:"pointer"}}>stop</button>
        </div>
      )}

      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input
          value={requestLink}
          onChange={(e)=>setRequestLink(e.target.value)}
          onKeyDown={(e)=>e.key === "Enter" && addRequest()}
          placeholder="request SoundCloud link..."
          style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:11,padding:"11px 12px",fontSize:12,color:"#E8ECF4",minWidth:0}}
        />
        <button onClick={addRequest} className="bb-pressable" style={{background:"rgba(255,85,0,0.12)",border:"1px solid rgba(255,85,0,0.28)",borderRadius:11,padding:"0 12px",fontSize:11,fontWeight:900,color:"#FF5500",cursor:"pointer"}}>queue</button>
      </div>

      {queue.length ? (
        <div>
          <div style={{fontSize:10,color:"#8B92A8",fontWeight:900,letterSpacing:.7,marginBottom:7}}>QUEUE</div>
          {queue.slice(0,5).map((entry, idx) => (
            <div key={entry.id} style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:11,padding:"9px 10px",marginBottom:7}}>
              <div style={{fontSize:10,color:"#FF5500",fontWeight:900,width:18}}>{idx+1}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11.5,color:"#E8ECF4",fontWeight:800,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{entry.title || displayTrack(entry.url)}</div>
                <div style={{fontSize:9.5,color:"#8B92A8",marginTop:2}}>requested by {entry.requestedByName || entry.requestedBy}</div>
              </div>
              {isDj && (
                <>
                  <button onClick={()=>playQueued(entry)} className="bb-pressable" style={{background:"rgba(184,255,77,0.12)",border:"1px solid rgba(184,255,77,0.25)",borderRadius:9,padding:"6px 8px",fontSize:10,fontWeight:900,color:"#B8FF4D",cursor:"pointer"}}>{entry.requestedBy === currentPlayer ? "play" : "accept"}</button>
                  <button onClick={()=>removeQueued(entry.id)} className="bb-pressable" style={{background:"none",border:"none",color:"#FF5C8A",fontSize:14,cursor:"pointer"}}>×</button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{fontSize:11,color:"#4A5066",textAlign:"center",padding:"4px 0 2px"}}>no requests queued</div>
      )}
    </div>
  );
}

function ChatTab({ messages, setMessages, currentPlayer, addToast, typingStatus, setTypingStatus, setTab, setChatOpen }) {
  const [text, setText] = useState("");
useEffect(() => {
  if (!text.trim()) {
    storeGet("typing").then(current => {
      const upd = { ...(current || {}) };
      delete upd[currentPlayer];
      setTypingStatus(upd);
      storeSet("typing", upd);
    });
    return;
  }
  storeGet("typing").then(current => {
    const upd = { ...(current || {}), [currentPlayer]: new Date().toISOString() };
    setTypingStatus(upd);
    storeSet("typing", upd);
  });
}, [text]);           
  const scrollRef = useRef(null);
  const didInitialChatScroll = useRef(false);
  useEffect(() => {
    const behavior = didInitialChatScroll.current ? "smooth" : "auto";
    requestAnimationFrame(() => {
      scrollRef.current?.scrollIntoView({ behavior, block: "end" });
      didInitialChatScroll.current = true;
    });
  }, [messages.length]);

  const send = async () => {
    if (!text.trim()) return;
    const msg = { id: Date.now().toString(), playerId: currentPlayer, text: text.trim(), ts: new Date().toISOString(), reactions: [] };
    const upd = [...messages, msg];
    setMessages(upd); await storeSet("chat", upd); setText("");
    addToast?.(`${PLAYERS.find(pl => pl.id === currentPlayer)?.name}: ${text.trim()}`, "💬");
  };

  const onReact = async (msgId, emoji) => {
    const upd = messages.map(m => {
      if (m.id !== msgId) return m;
      const reactions = m.reactions || [];
      const exists = reactions.find(r => r.playerId === currentPlayer && r.emoji === emoji);
      return { ...m, reactions: exists ? reactions.filter(r => !(r.playerId === currentPlayer && r.emoji === emoji)) : [...reactions, { playerId: currentPlayer, emoji, ts: new Date().toISOString() }] };
    });
    setMessages(upd); await storeSet("chat", upd);
  };

return (
    <div className="bb-tab-content" style={s.chatTabWrap}>
      <div style={{...s.chatHeader, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div>
          <div style={s.sectionLabel}>team chat</div>
          <div style={s.sectionSubLabel}>long press a message to react</div>
        </div>
<button onClick={()=>{ setChatOpen(false); setTab("room"); }} className="bb-pressable"
  style={{background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"7px 12px",fontSize:11,fontWeight:700,color:"#B8FF4D",cursor:"pointer",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
  🎙️ join vc
</button>
      </div>
      <div style={s.chatScroll}>
        {messages.length === 0 && <div style={s.chatEmpty}>no messages yet. say something to the squad.</div>}
        {messages.map((m) => <ChatMessage key={m.id} msg={m} isMe={m.playerId === currentPlayer} onReact={onReact} />)}
        {(() => {
          const now = Date.now();
          const typers = Object.entries(typingStatus)
            .filter(([pid, ts]) => pid !== currentPlayer && now - new Date(ts).getTime() < 8000)
            .map(([pid]) => PLAYERS.find(p => p.id === pid)?.name)
            .filter(Boolean);
          if (!typers.length) return null;
          return (
            <div style={{ padding: "4px 8px 8px", display: "flex", alignItems: "center", gap: 6, animation: "fadeSlideUp .2s ease" }}>
              <span style={{ fontSize: 11.5, color: "#4A5066", fontStyle: "italic" }}>
                {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing
              </span>
              <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 5, height: 5, borderRadius: "50%", background: "#4A5066", display: "inline-block",
                    animation: `bounceDot 1.2s ease-in-out infinite`,
                    animationDelay: `${i * 0.2}s`
                  }}/>
                ))}
              </span>
            </div>
          );
        })()}
        <div ref={scrollRef} />
      </div>
      <div style={s.chatInputRow}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="message the team..." style={s.chatInput} />
        <button onClick={send} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}><Send size={16} /></button>
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
function PostCard({ post, currentPlayer, onToggleHeart, onOpenComments, onExpand, onReactPost }) {
  const player=PLAYERS.find((p)=>p.id===post.playerId);
  const hearted=(post.hearts||[]).includes(currentPlayer);
  const [showPicker,setShowPicker]=useState(false);
  const [popped,setPopped]=useState(false);
  const [burst,setBurst]=useState(null);
  const pressTimer=useRef(null);
  useEffect(() => {
    if (post.image && !post.isVideo) {
      const img = new Image();
      img.src = post.image;
    }
  }, [post.image]);
  const handleTouchStart=()=>{pressTimer.current=setTimeout(()=>setShowPicker(true),500);};
  const handleTouchEnd=()=>{clearTimeout(pressTimer.current);};
  const handleMouseDown=()=>{pressTimer.current=setTimeout(()=>setShowPicker(true),500);};
  const handleMouseUp=()=>{clearTimeout(pressTimer.current);};
  const reactionCounts={};
  (post.reactions||[]).forEach(r=>{reactionCounts[r.emoji]=(reactionCounts[r.emoji]||0)+1;});
  const existingReactions=Object.keys(reactionCounts);
  const msgSeed=post.id?parseInt(post.id.slice(-6),10)||42:42;
  const shuffledEmojis=seededShuffle(REACTION_EMOJIS,msgSeed);
  const heartClick=()=>{setPopped(true);setTimeout(()=>setPopped(false),320);onToggleHeart(post.id);};

  const pickReaction=(emoji)=>{
    setShowPicker(false);
    setBurst({emoji,id:Date.now()});
    onReactPost(post.id,emoji);
    setTimeout(()=>setBurst(null),1400);
  };
return (
    <div style={s.postCard}>
      {/* Floating emoji burst */}
      {burst&&Array.from({length:6}).map((_,i)=>(
        <div key={`${burst.id}-${i}`} style={{
          position:"absolute",
          bottom:40,
          left:`${10+i*13}%`,
          zIndex:20,
          pointerEvents:"none",
          animation:"floatUp 1.6s ease forwards",
          animationDelay:`${i*0.12}s`,
          fontSize:28,
          opacity:0,
        }}>
          {burst.emoji}
        </div>
      ))}
      <div style={s.postHeader}>
        <div style={{width:8,height:8,borderRadius:99,background:player?.color,boxShadow:`0 0 8px ${player?.color}99`}}/>
        <span style={{fontWeight:700,fontSize:13.5}}>{player?.name}</span>
        <span style={s.postTime}>{fmtRelTime(post.ts)}</span>
      </div>
      <div onClick={()=>onExpand(post)} style={{cursor:"pointer"}}>
        {post.image&&(post.isVideo
          ?<video src={post.image} style={s.postImage} controls muted playsInline loop/>
          :<img src={post.image} alt="post" style={s.postImage}/>)}
        {post.caption&&<div style={s.postCaption}>{post.caption}</div>}
      </div>
      <div style={{...s.postActions,position:"relative"}}>
        <button onClick={heartClick} className="bb-pressable" style={s.postActionBtn}>
          <Heart size={18} className={popped?"bb-heart-pop":""} color={hearted?"#FF5C8A":"#4A5066"} fill={hearted?"#FF5C8A":"none"}/>
          <span style={{color:hearted?"#FF5C8A":"#4A5066",fontSize:12.5,fontWeight:700}}>{(post.hearts||[]).length}</span>
        </button>
        <button onClick={()=>onOpenComments(post)} className="bb-pressable" style={s.postActionBtn}>
          <MessageCircle size={17} color="#4A5066"/>
          <span style={{color:"#4A5066",fontSize:12.5,fontWeight:700}}>{(post.comments||[]).length}</span>
        </button>
        <button onClick={()=>setShowPicker(v=>!v)} className="bb-pressable" style={s.postActionBtn}>
          <span style={{fontSize:17}}>😀</span>
        </button>
        {showPicker&&(
          <div style={{position:"absolute",bottom:44,right:14,display:"flex",gap:4,background:"#1A1D2E",border:"1px solid rgba(255,255,255,0.12)",borderRadius:22,padding:"6px 10px",flexWrap:"wrap",maxWidth:240,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",zIndex:10}}>
            {shuffledEmojis.map(emoji=>(
              <button key={emoji} onClick={()=>pickReaction(emoji)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",padding:"2px 3px"}}>{emoji}</button>
            ))}
          </div>
        )}
      </div>
      {existingReactions.length>0&&(
        <div style={{display:"flex",gap:4,padding:"0 14px 12px",flexWrap:"wrap"}}>
          {existingReactions.map(emoji=>(
            <button key={emoji} onClick={()=>onReactPost(post.id,emoji)}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:99,padding:"2px 8px",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:4,color:"#E8ECF4"}}>
              {emoji}
<span style={{fontSize:10,color:"#8B92A8",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
  {(post.postReactions||[]).filter(r=>r.emoji===emoji).map(r=>PLAYERS.find(p=>p.id===r.playerId)?.name).filter(Boolean).join(" · ")}
</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function PostFullscreenModal({ post, currentPlayer, onToggleHeart, onClose }) {
  const player = PLAYERS.find((p) => p.id === post.playerId);
  const hearted = (post.hearts || []).includes(currentPlayer);
  const [swipeOffset, setSwipeOffset] = useState(0);
const [imgLoaded, setImgLoaded] = useState(false);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

  const handleTouchStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dx > 0 && dx > dy) setSwipeOffset(dx);
  };
  const handleTouchEnd = () => {
    if (swipeOffset > 80) {
      onClose();
      setSwipeOffset(0);
    } else {
      setSwipeOffset(0);
    }
  };

  return (
    <div
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position:"fixed", inset:0, zIndex:600, background:"#000",
        display:"flex", flexDirection:"column",
        animation:"chatFadeIn .2s ease",
        transform:`translateX(${swipeOffset}px)`,
        opacity: Math.max(0, 1 - swipeOffset / 280),
        transition: swipeOffset === 0 ? "transform .25s ease, opacity .25s ease" : "none",
      }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"16px 16px", paddingTop:"max(16px, env(safe-area-inset-top))", flexShrink:0 }}>
        <div style={{ width:8, height:8, borderRadius:99, background:player?.color, boxShadow:`0 0 8px ${player?.color}99` }}/>
        <span style={{ fontWeight:700, fontSize:14, color:"#fff" }}>{player?.name}</span>
        <span style={{ fontSize:11.5, color:"#8B92A8" }}>{fmtRelTime(post.ts)}</span>
        <button onClick={onClose} className="bb-pressable" style={{ marginLeft:"auto", background:"rgba(255,255,255,0.1)", border:"none", borderRadius:99, width:34, height:34, color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <X size={18}/>
        </button>
      </div>
<div onClick={(e)=>e.stopPropagation()} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", position:"relative" }}>
  {post.image && !imgLoaded && !post.isVideo && (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.03)" }}>
      <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid rgba(255,255,255,0.08)", borderTopColor: player?.color || "#B8FF4D", animation:"spin .8s linear infinite" }}/>
    </div>
  )}
  {post.image && (post.isVideo
    ? <video src={post.image} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }} controls muted playsInline loop autoPlay/>
    : <img src={post.image} alt="post" onLoad={()=>setImgLoaded(true)} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", opacity: imgLoaded ? 1 : 0, transition:"opacity .2s ease" }}/>
  )}
</div>
{post.caption && (
  <div onClick={(e)=>e.stopPropagation()} style={{ padding:"14px 16px", paddingBottom:"max(14px, env(safe-area-inset-bottom))", flexShrink:0 }}>
    <div style={{ fontSize:14, color:"#E8ECF4", lineHeight:1.5, marginBottom:10 }}>{post.caption}</div>
    <button onClick={()=>onToggleHeart(post.id)} className="bb-pressable" style={{ background:"none", border:"none", display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
      <Heart size={20} color={hearted?"#FF5C8A":"#8B92A8"} fill={hearted?"#FF5C8A":"none"}/>
      <span style={{ color:hearted?"#FF5C8A":"#8B92A8", fontSize:13, fontWeight:700 }}>{(post.hearts||[]).length}</span>
    </button>
  </div>
)}
  </div>
  );
}


function PostCommentsModal({ post, onAddComment, onHeartComment, currentPlayer, onClose }) {
  const [text,setText]=useState("");
  const submit=()=>{ if(!text.trim())return; onAddComment(post.id,text.trim()); setText(""); };
  return (
    <div style={s.modalOverlay} onClick={onClose}><div style={{...s.modalBox,maxHeight:"75vh",display:"flex",flexDirection:"column"}} onClick={(e)=>e.stopPropagation()}>
      <div style={s.modalHeader}><div style={s.modalTitle}>comments</div><button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button></div>
      <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
        {!(post.comments||[]).length&&<div style={s.chatEmpty}>no comments yet.</div>}
       {(post.comments||[]).map((c)=>{ const p=PLAYERS.find((pl)=>pl.id===c.playerId); const hearted=(c.hearts||[]).includes(currentPlayer); return <div key={c.id} style={{...s.commentItem,justifyContent:"space-between",alignItems:"flex-start"}}><div style={{display:"flex",gap:8,flex:1}}><div style={{width:6,height:6,borderRadius:99,background:p?.color,marginTop:6,flexShrink:0}}/><div><div style={{fontSize:12,fontWeight:700,color:p?.color}}>{p?.name}</div><div style={{fontSize:14,color:"#E8ECF4"}}>{c.text}</div></div></div><button onClick={()=>onHeartComment(post.id,c.id)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4,flexShrink:0,padding:"2px 4px"}}><Heart size={14} color={hearted?"#FF5C8A":"#4A5066"} fill={hearted?"#FF5C8A":"none"}/><span style={{fontSize:11,color:hearted?"#FF5C8A":"#4A5066"}}>{(c.hearts||[]).length||""}</span></button></div>; })}
      </div>
      <div style={s.chatInputRow}><input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&submit()} placeholder="add a comment..." style={s.chatInput}/><button onClick={submit} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}><Send size={16}/></button></div>
    </div></div>
  );
}
function SocialTab({ posts, setPosts, currentPlayer, addToast, bets, setBets, points, setPoints, stats }) {
  const [composing, setComposing] = useState(false);
  const [commentingOn, setCommentingOn] = useState(null);
  const [expandedPost, setExpandedPost] = useState(null);
  const [subTab, setSubTab] = useState("feed");
  const [copiedBet, setCopiedBet] = useState(null);
  const [parlayLegs, setParlayLegs] = useState([]);
  const [parlayWager, setParlayWager] = useState(10);
  const [showParlay, setShowParlay] = useState(false);

  const addPost = async (data) => {
    let img = null;
    if (data.file) img = await uploadPostImage(data.file);
    const post = { id: Date.now().toString(), playerId: currentPlayer, caption: data.caption, image: img, isVideo: data.file?.type?.startsWith("video/"), ts: new Date().toISOString(), hearts: [], comments: [] };
    const upd = [post, ...posts];
    setPosts(upd);
    await storeSet("posts", upd);
    addToast?.(`${PLAYERS.find(pl => pl.id === currentPlayer)?.name} posted something`, "📸");
  };

const pushActivity = async ({ to, type, fromName, text, message = "", gameId = "" }) => {
  const existing = await storeGet("activity_feed") || [];
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    to,
    type,
    fromName,
    text,
    message,
    gameId,
    ts: new Date().toISOString(),
    seen: false
  };
  const upd = [entry, ...existing].slice(0, 80);
  await storeSet("activity_feed", upd);
};

  const toggleHeart = async (postId) => {
    const post = posts.find(p => p.id === postId);
    const hearts = post?.hearts || [];
    const isLiking = !hearts.includes(currentPlayer);
    const upd = posts.map(p => { if (p.id !== postId) return p; return { ...p, hearts: hearts.includes(currentPlayer) ? hearts.filter(id => id !== currentPlayer) : [...hearts, currentPlayer] }; });
    setPosts(upd);
    await storeSet("posts", upd);
    if (isLiking && post && post.playerId !== currentPlayer) {
      await pushActivity({ to: post.playerId, type: "like", fromName: PLAYERS.find(p=>p.id===currentPlayer)?.name, text: `liked your post` });
    }
  };

const reactToPost = async (postId, emoji) => {
    const post = posts.find(p => p.id === postId);
    const upd = posts.map(p => p.id===postId ? {...p, postReactions:[...(p.postReactions||[]), {playerId:currentPlayer, emoji, ts:new Date().toISOString()}]} : p);
    setPosts(upd);
    await storeSet("posts", upd);
    if (post && post.playerId !== currentPlayer) {
      await pushActivity({ to: post.playerId, type: "post_react", fromName: PLAYERS.find(p=>p.id===currentPlayer)?.name, text: `reacted ${emoji} to your post` });
    }
  };


const addComment = async (postId, text) => {
    const comment = { id: Date.now().toString(), playerId: currentPlayer, text, ts: new Date().toISOString(), hearts: [] };
    const upd = posts.map(p => p.id === postId ? { ...p, comments: [...(p.comments || []), comment] } : p);
    setPosts(upd);
    await storeSet("posts", upd);
    setCommentingOn(prev => prev ? upd.find(p => p.id === prev.id) : prev);
    const post = posts.find(p => p.id === postId);
    if (post && post.playerId !== currentPlayer) {
      await pushActivity({ to: post.playerId, type: "comment", fromName: PLAYERS.find(p=>p.id===currentPlayer)?.name, text: `left a comment on your post` });
    }
  };

  const heartComment = async (postId, commentId) => {
    const upd = posts.map(p => {
      if (p.id !== postId) return p;
      const comments = (p.comments||[]).map(c => {
        if (c.id !== commentId) return c;
        const hearts = c.hearts||[];
        const liked = hearts.includes(currentPlayer);
        return { ...c, hearts: liked ? hearts.filter(id=>id!==currentPlayer) : [...hearts, currentPlayer] };
      });
      return { ...p, comments };
    });
    setPosts(upd);
    await storeSet("posts", upd);
    setCommentingOn(prev => prev ? upd.find(p => p.id === prev.id) : prev);
    const post = posts.find(p => p.id === postId);
    const comment = post?.comments?.find(c => c.id === commentId);
    if (comment && comment.playerId !== currentPlayer) {
      await pushActivity({ to: comment.playerId, type: "comment_heart", fromName: PLAYERS.find(p=>p.id===currentPlayer)?.name, text: `liked your comment` });
    }
  };
  // All bets from teammates (not current player)
  const teammateBets = (bets || []).filter(b => b.bettorId !== currentPlayer);

  const copyBet = (bet) => {
    setCopiedBet(bet);
  };

  const placeCopiedBet = async () => {
    if (!copiedBet) return;
    const myPoints = points?.[currentPlayer] || 0;
    const wager = copiedBet.wager;
    if (myPoints < wager) return;
    const newBet = {
      id: Date.now().toString(),
      bettorId: currentPlayer,
      playerId: copiedBet.playerId,
      playerName: copiedBet.playerName,
      field: copiedBet.field,
      line: copiedBet.line,
      side: copiedBet.side,
      wager,
      payout: copiedBet.payout,
      odds: copiedBet.odds,
      status: "open",
      placedAt: new Date().toISOString(),
      copiedFrom: copiedBet.bettorId,
    };
    const newPts = myPoints - wager;
    const upd = { ...points, [currentPlayer]: newPts };
    setPoints(upd);
    await storeSet("points", upd);
    const updBets = [...(bets || []), newBet];
    setBets(updBets);
    await storeSet("bets", updBets);
    addToast?.("bet copied and placed!", "🎯");
    setCopiedBet(null);
  };

  const addParlayLeg = (bet) => {
    if (parlayLegs.find(l => l.id === bet.id)) {
      setParlayLegs(prev => prev.filter(l => l.id !== bet.id));
    } else if (parlayLegs.length < 4) {
      setParlayLegs(prev => [...prev, bet]);
    }
  };

  const parlayMultiplier = parlayLegs.reduce((mult, leg) => {
    const dec = parseFloat(leg.odds?.replace("+","") || "100");
    const oddsDecimal = leg.odds?.startsWith("+") ? (dec / 100) + 1 : (100 / Math.abs(dec)) + 1;
    return mult * oddsDecimal;
  }, 1);

  const parlayPayout = Math.round(parlayWager * parlayMultiplier);

  const placeParlay = async () => {
    if (parlayLegs.length < 2) return;
    const myPoints = points?.[currentPlayer] || 0;
    if (myPoints < parlayWager) return;
    const parlayBet = {
      id: Date.now().toString(),
      bettorId: currentPlayer,
      isParlay: true,
      legs: parlayLegs.map(l => ({ playerId: l.playerId, playerName: l.playerName, field: l.field, line: l.line, side: l.side, odds: l.odds })),
      wager: parlayWager,
      payout: parlayPayout,
      multiplier: parlayMultiplier.toFixed(2),
      status: "open",
      placedAt: new Date().toISOString(),
    };
    const upd = { ...points, [currentPlayer]: myPoints - parlayWager };
    setPoints(upd);
    await storeSet("points", upd);
    const updBets = [...(bets || []), parlayBet];
    setBets(updBets);
    await storeSet("bets", updBets);
    addToast?.(`${parlayLegs.length}-leg parlay placed!`, "🎰");
    setParlayLegs([]);
    setShowParlay(false);
    setParlayWager(10);
  };

  return (
    <div className="bb-tab-content" style={s.tabContent}>
   {composing && <SocialComposer currentPlayer={currentPlayer} onPost={addPost} onClose={() => setComposing(false)} />}
   {commentingOn && <PostCommentsModal post={commentingOn} onAddComment={addComment} onHeartComment={heartComment} currentPlayer={currentPlayer} onClose={() => setCommentingOn(null)} />}
      {expandedPost && <PostFullscreenModal post={posts.find(p=>p.id===expandedPost.id)||expandedPost} currentPlayer={currentPlayer} onToggleHeart={toggleHeart} onClose={() => setExpandedPost(null)} />}

      {/* Copied bet modal */}
      {copiedBet && (
        <div style={s.modalOverlay} onClick={() => setCopiedBet(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div style={s.modalTitle}>copy this bet?</div>
              <button onClick={() => setCopiedBet(null)} className="bb-pressable" style={s.modalClose}><X size={20} /></button>
            </div>
            <div style={{ background: "rgba(184,255,77,0.06)", border: "1px solid rgba(184,255,77,0.2)", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 6 }}>
                {copiedBet.playerName} {copiedBet.side} {copiedBet.line} {copiedBet.field}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8B92A8" }}>
                <span>wager: <span style={{ color: "#B8FF4D", fontWeight: 700 }}>{copiedBet.wager} pts</span></span>
                <span>odds: <span style={{ color: "#E8ECF4", fontWeight: 700 }}>{copiedBet.odds}</span></span>
                <span>to win: <span style={{ color: "#7CFFB2", fontWeight: 700 }}>{copiedBet.payout} pts</span></span>
              </div>
              <div style={{ fontSize: 11, color: "#4A5066", marginTop: 8 }}>
                copied from {PLAYERS.find(p => p.id === copiedBet.bettorId)?.name}
              </div>
            </div>
            <button onClick={placeCopiedBet} disabled={(points?.[currentPlayer] || 0) < copiedBet.wager} className="bb-pressable bb-glow-lime"
              style={{ ...s.primaryBtn, opacity: (points?.[currentPlayer] || 0) < copiedBet.wager ? 0.4 : 1 }}>
              {(points?.[currentPlayer] || 0) < copiedBet.wager ? "not enough pts" : `place bet — ${copiedBet.wager} pts`}
            </button>
          </div>
        </div>
      )}

{/* Sub tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setSubTab("feed")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", background: subTab === "feed" ? "#B8FF4D" : "rgba(255,255,255,0.05)", color: subTab === "feed" ? "#06070D" : "#8B92A8" }}>
          📸 feed
        </button>
        <button onClick={() => setSubTab("bets")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", background: subTab === "bets" ? "#B8FF4D" : "rgba(255,255,255,0.05)", color: subTab === "bets" ? "#06070D" : "#8B92A8" }}>
          🎰 bets
        </button>
      </div>

      {subTab === "feed" && (
        <>
          <div style={s.sectionRowHeader}>
            <div style={s.sectionLabel}>team feed</div>
            <button onClick={() => setComposing(true)} className="bb-pressable bb-glow-violet" style={s.newPostBtn}><Plus size={14} /> post</button>
          </div>
          {posts.length === 0 && <div style={s.emptyQueue}>no posts yet — share a clip or a funny moment.</div>}
       {posts.map(post => <PostCard key={post.id} post={post} currentPlayer={currentPlayer} onToggleHeart={toggleHeart} onOpenComments={setCommentingOn} onExpand={setExpandedPost} onReactPost={reactToPost} />)}
        </>
      )}

{subTab === "bets" && (
        <>
          <div style={s.sectionRowHeader}>
            <div style={s.sectionLabel}>teammate bets</div>
            <button onClick={() => setShowParlay(v => !v)} className="bb-pressable bb-glow-violet"
              style={{ ...s.newPostBtn, background: parlayLegs.length > 0 ? "rgba(255,209,102,0.15)" : "rgba(167,139,250,0.12)", borderColor: parlayLegs.length > 0 ? "rgba(255,209,102,0.4)" : "rgba(167,139,250,0.3)", color: parlayLegs.length > 0 ? "#FFD166" : "#A78BFA" }}>
              🎰 parlay {parlayLegs.length > 0 ? `(${parlayLegs.length} legs)` : ""}
            </button>
          </div>

          {/* Parlay builder */}
          {showParlay && (
            <div style={{ background: "#11131F", borderRadius: 14, padding: 14, marginBottom: 16, border: "1px solid rgba(255,209,102,0.25)" }}>
              <div style={{ fontSize: 12, color: "#FFD166", fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>PARLAY BUILDER</div>
              {parlayLegs.length === 0 ? (
                <div style={{ fontSize: 12, color: "#4A5066", marginBottom: 10 }}>tap + on any bet below to add a leg. up to 4 legs.</div>
              ) : (
                <>
                  {parlayLegs.map((leg, i) => (
                    <div key={leg.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "8px 10px" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4" }}>{leg.playerName} {leg.side} {leg.line} {leg.field}</div>
                        <div style={{ fontSize: 10, color: "#4A5066" }}>{leg.odds}</div>
                      </div>
                      <button onClick={() => setParlayLegs(prev => prev.filter((_, idx) => idx !== i))} className="bb-pressable"
                        style={{ background: "none", border: "none", color: "#FF5C8A", cursor: "pointer" }}><X size={14} /></button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#4A5066", marginBottom: 4 }}>MULTIPLIER</div>
                      <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 18, fontWeight: 700, color: "#FFD166" }}>{parlayMultiplier.toFixed(2)}x</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#4A5066", marginBottom: 4 }}>WAGER</div>
                      <input type="number" value={parlayWager} onChange={e => setParlayWager(Math.max(1, Number(e.target.value)))}
                        style={{ ...s.modalInput, padding: "8px 10px", fontSize: 14 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#4A5066", marginBottom: 4 }}>TO WIN</div>
                      <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 18, fontWeight: 700, color: "#7CFFB2" }}>{parlayPayout}</div>
                    </div>
                  </div>
                  <button onClick={placeParlay} disabled={parlayLegs.length < 2 || (points?.[currentPlayer] || 0) < parlayWager}
                    className="bb-pressable bb-glow-lime" style={{ ...s.primaryBtn, marginTop: 12, opacity: parlayLegs.length < 2 || (points?.[currentPlayer] || 0) < parlayWager ? 0.4 : 1 }}>
                    place {parlayLegs.length}-leg parlay — {parlayWager} pts to win {parlayPayout}
                  </button>
                </>
              )}
            </div>
          )}

          {teammateBets.filter(b => !b.isParlay).length === 0 && (
            <div style={s.emptyQueue}>no teammate bets yet — check back after someone visits the boost tab.</div>
          )}

          {teammateBets.filter(b => !b.isParlay).map(bet => {
            const bettor = PLAYERS.find(p => p.id === bet.bettorId);
            const subject = PLAYERS.find(p => p.id === bet.playerId);
            const isInParlay = parlayLegs.find(l => l.id === bet.id);
            const won = bet.status === "won";
            const lost = bet.status === "lost";
            return (
              <div key={bet.id} style={{ background: "#11131F", borderRadius: 14, padding: 14, marginBottom: 10, border: `1px solid ${bet.status === "open" ? "rgba(255,209,102,0.15)" : won ? "rgba(124,255,178,0.15)" : "rgba(255,92,138,0.1)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 99, background: bettor?.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: bettor?.color }}>{bettor?.name}</span>
                  <span style={{ fontSize: 10, color: "#4A5066", marginLeft: "auto" }}>{fmtRelTime(bet.placedAt)}</span>
                  {bet.status !== "open" && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: won ? "#7CFFB2" : "#FF5C8A", background: won ? "rgba(124,255,178,0.1)" : "rgba(255,92,138,0.1)", padding: "2px 7px", borderRadius: 99 }}>
                      {won ? "WON" : "LOST"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 6 }}>
                  {bet.playerName} {bet.side} {bet.line} {bet.field}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8B92A8", marginBottom: 10 }}>
                  <span>wagered <span style={{ color: "#FFD166", fontWeight: 700 }}>{bet.wager} pts</span></span>
                  <span>odds <span style={{ color: "#E8ECF4", fontWeight: 700 }}>{bet.odds}</span></span>
                  <span>to win <span style={{ color: "#7CFFB2", fontWeight: 700 }}>{bet.payout} pts</span></span>
                </div>
                {bet.status === "open" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => copyBet(bet)} className="bb-pressable bb-glow-lime"
                      style={{ flex: 1, background: "rgba(184,255,77,0.1)", border: "1px solid rgba(184,255,77,0.3)", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, color: "#B8FF4D", cursor: "pointer" }}>
                      copy bet
                    </button>
                    <button onClick={() => addParlayLeg(bet)} className="bb-pressable"
                      style={{ width: 42, background: isInParlay ? "#FFD166" : "rgba(255,209,102,0.1)", border: `1px solid ${isInParlay ? "#FFD166" : "rgba(255,209,102,0.3)"}`, borderRadius: 10, fontSize: 16, color: isInParlay ? "#06070D" : "#FFD166", cursor: "pointer" }}>
                      {isInParlay ? "✓" : "+"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Teammate parlays */}
          {teammateBets.filter(b => b.isParlay).length > 0 && (
            <>
              <div style={{ ...s.sectionLabel, marginTop: 20, marginBottom: 10 }}>teammate parlays</div>
              {teammateBets.filter(b => b.isParlay).map(bet => {
                const bettor = PLAYERS.find(p => p.id === bet.bettorId);
                const won = bet.status === "won";
                return (
                  <div key={bet.id} style={{ background: "#11131F", borderRadius: 14, padding: 14, marginBottom: 10, border: "1px solid rgba(167,139,250,0.2)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 7, height: 7, borderRadius: 99, background: bettor?.color }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: bettor?.color }}>{bettor?.name}</span>
                      <span style={{ fontSize: 10, color: "#A78BFA", fontWeight: 700, marginLeft: 4 }}>{bet.legs?.length}-leg parlay</span>
                      <span style={{ fontSize: 10, color: "#4A5066", marginLeft: "auto" }}>{fmtRelTime(bet.placedAt)}</span>
                    </div>
                    {(bet.legs || []).map((leg, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#8B92A8", marginBottom: 4 }}>
                        <span style={{ color: "#E8ECF4", fontWeight: 600 }}>{leg.playerName}</span> {leg.side} {leg.line} {leg.field} <span style={{ color: "#A78BFA" }}>{leg.odds}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "#8B92A8" }}>
                      <span>wagered <span style={{ color: "#FFD166", fontWeight: 700 }}>{bet.wager} pts</span></span>
                      <span>{bet.multiplier}x multiplier</span>
                      <span>to win <span style={{ color: "#7CFFB2", fontWeight: 700 }}>{bet.payout} pts</span></span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
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
function AdminTab({ trainingData, setTrainingData, mmrProfiles, setMmrProfiles, addToast, completions, setCompletions, passXP, setPassXP, parseCredits, setParseCredits, creditRequests, setCreditRequests }) {
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
  <VerificationTab trainingData={trainingData} completions={completions} setCompletions={setCompletions} addToast={addToast} passXP={passXP} setPassXP={setPassXP}/>

{/* Credit Requests */}
{(creditRequests||[]).filter(r=>r.status==="pending").length > 0 && (
  <div style={{marginBottom:24}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
      <span style={{fontSize:13,fontWeight:700,color:"#4D9EFF"}}>⚡ parse credit requests</span>
      <span style={{fontSize:11,color:"#4A5066"}}>{(creditRequests||[]).filter(r=>r.status==="pending").length} pending</span>
    </div>
    <div style={{fontSize:11,color:"#4A5066",marginBottom:10}}>
      reserve: <span style={{color:"#4D9EFF",fontWeight:700}}>{parseCredits?.reserve ?? PARSE_RESERVE_DEFAULT}</span> credits remaining
    </div>
    {(creditRequests||[]).filter(r=>r.status==="pending").map(req=>(
      <div key={req.id} style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:"1px solid rgba(77,158,255,0.25)"}}>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,color:"#4D9EFF"}}>{req.playerName}</div>
          <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>
            current balance: <span style={{color:"#E8ECF4",fontWeight:700}}>{parseCredits?.[req.playerId] ?? PARSE_CREDITS_DEFAULT}</span> credits · requested {fmtRelTime(req.requestedAt)}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[10,25,50].map(amt=>(
            <button key={amt} onClick={async()=>{
              const reserve = parseCredits?.reserve ?? PARSE_RESERVE_DEFAULT;
              if(reserve < amt){ addToast?.("not enough in reserve","❌"); return; }
              const current = parseCredits?.[req.playerId] ?? PARSE_CREDITS_DEFAULT;
              const upd = {...parseCredits,[req.playerId]:current+amt,reserve:reserve-amt};
              setParseCredits(upd);
              await storeSet("parse_credits",upd);
              const updReqs = (creditRequests||[]).map(r=>r.id===req.id?{...r,status:"approved",approvedAt:new Date().toISOString(),amount:amt}:r);
              setCreditRequests(updReqs);
              await storeSet("credit_requests",updReqs);
              addToast?.(`+${amt} credits sent to ${req.playerName}`,"✅");
            }} className="bb-pressable bb-glow-lime"
              style={{flex:1,background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,color:"#B8FF4D",cursor:"pointer"}}>
              +{amt}
            </button>
          ))}
          <button onClick={async()=>{
            const updReqs=(creditRequests||[]).map(r=>r.id===req.id?{...r,status:"denied",deniedAt:new Date().toISOString()}:r);
            setCreditRequests(updReqs);
            await storeSet("credit_requests",updReqs);
            addToast?.(`denied ${req.playerName}'s credit request`,"❌");
          }} className="bb-pressable"
            style={{flex:1,background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,color:"#FF5C8A",cursor:"pointer"}}>
            deny
          </button>
        </div>
      </div>
    ))}
  </div>
)}


      <div style={s.adminHeader}><Shield size={16} color="#FF5C8A"/><span style={s.adminHeaderText}>captain controls</span></div>
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
const STAT_MODES = ["2v2","1v1"];
const LOGGABLE_MODES = ["2v2","1v1"];
const STAT_FIELDS = ["goals","assists","saves","shots"];

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
const [roomId, setRoomId] = useState(null);
useEffect(() => {
  storeGet("team_room").then(room => {
    if (room?.id) setRoomId(room.id);
  }).catch(()=>{});
}, []);
  const [ourScore, setOurScore] = useState("");
  const [theirScore, setTheirScore] = useState("");
  const [goals, setGoals] = useState("");
  const [assists, setAssists] = useState("");
  const [saves, setSaves] = useState("");
  const [shots, setShots] = useState("");
  const [score, setScore] = useState("");
  const [demos, setDemos] = useState("");
  const [teammateId, setTeammateId] = useState(PLAYERS.find(p => p.id !== currentPlayer)?.id || "");


  const submit = () => {
    if (ourScore === "" || theirScore === "") return;
    const manualSessionCode = mode === "2v2" ? `manual_${Date.now()}` : null;
    const entry = {
      id: Date.now().toString(),
      playerId: currentPlayer,
      mode,
      ourScore: Number(ourScore),
      theirScore: Number(theirScore),
      goals: Number(goals) || 0,
      assists: Number(assists) || 0,
      saves: Number(saves) || 0,
      shots: Number(shots) || 0,
      score: Number(score) || 0,
      demos: Number(demos) || 0,
      ts: new Date().toISOString(),
      duoIds: mode === "2v2" ? [currentPlayer, teammateId].filter(Boolean) : [currentPlayer],
roomId: (roomId && (mode === "3v3" || mode === "2v2")) ? roomId : null,
sessionCode: (roomId && (mode === "3v3" || mode === "2v2")) ? roomId : manualSessionCode,
    };
    onSave(entry);
    onClose();
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>log {mode} game</div>
          <button onClick={onClose} className="bb-pressable" style={s.modalClose}><X size={20}/></button>
        </div>

        <div style={s.modalLabel}>score</div>
        <div style={s.modalScoreRow}>
          <div style={{flex:1}}><div style={s.modalLabel}>us</div><input type="number" value={ourScore} onChange={e=>setOurScore(e.target.value)} placeholder="0" style={s.modalInput}/></div>
          <div style={{flex:1}}><div style={s.modalLabel}>them</div><input type="number" value={theirScore} onChange={e=>setTheirScore(e.target.value)} placeholder="0" style={s.modalInput}/></div>
        </div>
        {mode === "2v2" && (
          <div style={{marginBottom:12}}>
            <div style={s.modalLabel}>duo teammate</div>
            <div style={{display:"flex",gap:8}}>
              {PLAYERS.filter(p=>p.id!==currentPlayer).map(p => (
                <button key={p.id} onClick={()=>setTeammateId(p.id)} className="bb-pressable"
                  style={{flex:1,background:teammateId===p.id?`${p.color}22`:"rgba(255,255,255,0.04)",border:`1px solid ${teammateId===p.id?p.color+"66":"rgba(255,255,255,0.08)"}`,borderRadius:10,padding:"9px 8px",fontSize:11,fontWeight:800,color:teammateId===p.id?p.color:"#8B92A8",cursor:"pointer"}}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={s.modalLabel}>your stats</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[["goals",goals,setGoals],["assists",assists,setAssists],["saves",saves,setSaves],["shots",shots,setShots],["score",score,setScore],["demos",demos,setDemos]].map(([label,val,setter])=>(
            <div key={label}>
              <div style={s.modalLabel}>{label}</div>
              <input type="number" value={val} onChange={e=>setter(e.target.value)} placeholder="0" style={s.modalInput}/>
            </div>
          ))}
        </div>
{roomId && (mode === "3v3" || mode === "2v2") && (
  <div style={{background:"rgba(184,255,77,0.08)",border:"1px solid rgba(184,255,77,0.25)",borderRadius:10,padding:"10px 12px",marginTop:4}}>
    <div style={{fontSize:11,fontWeight:700,color:"#B8FF4D"}}>✓ team room active — your stats will link automatically</div>
  </div>
)} <button onClick={submit} disabled={ourScore===""||theirScore===""} className="bb-pressable bb-glow-lime"
          style={{...s.primaryBtn,opacity:ourScore===""||theirScore===""?0.4:1,marginTop:16}}>
          save game
        </button>
      </div>
    </div>
  );
}


function GameDetailModal({ game, allPlayerGames, onClose, onUpdateOpponentScore }) {
  const [localTheirScore, setLocalTheirScore] = useState(game?.theirScore ?? "");
  const displayGame = { ...game, theirScore: localTheirScore === "" ? null : Number(localTheirScore) };
  const won = gameIsWin(game);
  const scoreIsSynced = game?.source === "parse_sessions";
  const saveOpponentScore = () => {
    const val = Number(localTheirScore);
    if (!Number.isFinite(val)) return;
    onUpdateOpponentScore?.(game, val);
  };
const FIELDS = ["goals","assists","saves","shots"];
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const handleTouchStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dx > 0 && dx > dy) setSwipeOffset(dx);
  };
  const handleTouchEnd = () => {
    if (swipeOffset > 80) { onClose(); setSwipeOffset(0); }
    else setSwipeOffset(0);
  };

  // Get player's last 10 games for sparkline context
  const last10 = allPlayerGames.slice(-10);
  const player = PLAYERS.find(p => p.id === game.playerId);

  const avg = (field) => last10.length
    ? (last10.reduce((s,g) => s+(g[field]||0),0)/last10.length)
    : 0;

  return (
<div
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
 style={{position:"fixed",inset:0,zIndex:500,background:"#040818",display:"flex",flexDirection:"column",animation:"scaleFadeIn .3s cubic-bezier(.2,.8,.2,1)",transform:`translateX(${swipeOffset}px)`,transition:swipeOffset===0?"transform .25s ease":"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 18px",paddingTop:"max(16px,env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
        <button onClick={onClose} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <ChevronLeft size={18}/>
        </button>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600}}>game detail</div>
        <div style={{marginLeft:"auto",fontSize:10,color:"#4A5066"}}>{fmtRelTime(game.ts)}</div>
      </div>

     <div style={{flex:1,overflowY:"auto",padding:"20px 16px",paddingBottom:"100px"}}>
        {/* Score hero */}
        <div style={{background:`linear-gradient(135deg,${won?"rgba(124,255,178,0.12)":"rgba(255,92,138,0.08)"},#0C0E18)`,border:`1px solid ${won?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.2)"}`,borderRadius:20,padding:"24px",textAlign:"center",marginBottom:20}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:56,fontWeight:700,color:"#E8ECF4",letterSpacing:2}}>{formatGameScore(displayGame)}</div>
          <div style={{fontSize:13,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A",letterSpacing:1,marginTop:4}}>{won?"WIN":"LOSS"}</div>
          <div style={{fontSize:11,color:"#4A5066",marginTop:6}}>{game.mode} · {fmtRelTime(game.ts)}{scoreIsSynced ? " · live synced" : ""}</div>
        </div>

        {scoreIsSynced && (
          <div style={{background:"#11131F",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:"13px 14px",marginBottom:18}}>
            <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900,letterSpacing:1,textTransform:"uppercase",marginBottom:5}}>opponent score</div>
            <div style={{fontSize:11,color:"#8B92A8",lineHeight:1.4,marginBottom:10}}>Your score is pulled from combined goals. Add the opponent score here; win/loss still comes from Tracker.</div>
            <div style={{display:"flex",gap:8}}>
              <input type="number" value={localTheirScore} onChange={e=>setLocalTheirScore(e.target.value)} placeholder="them" style={{...s.modalInput,flex:1,marginBottom:0}} />
              <button onClick={saveOpponentScore} disabled={localTheirScore===""} className="bb-pressable bb-glow-lime" style={{background:"#B8FF4D",border:"none",borderRadius:11,padding:"0 13px",fontSize:11,fontWeight:900,color:"#06070D",cursor:"pointer",opacity:localTheirScore==="" ? .5 : 1}}>save</button>
            </div>
          </div>
        )}

        {/* Stat bars vs personal avg */}
        <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>THIS GAME VS YOUR AVG (last 10)</div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
          {FIELDS.map(field => {
            const val = game[field] || 0;
            const average = avg(field);
            const max = Math.max(val, average, 1);
            const valPct = val / max;
            const avgPct = average / max;
            const above = val >= average;
            return (
              <div key={field} style={{background:"#11131F",borderRadius:14,padding:"13px 14px",border:`1px solid ${above?"rgba(124,255,178,0.1)":"rgba(255,92,138,0.06)"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:11,color:"#4A5066",fontWeight:700,textTransform:"uppercase",letterSpacing:0.6}}>{field}</div>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#4A5066"}}>avg <span style={{color:"#8B92A8",fontWeight:700}}>{average.toFixed(1)}</span></span>
                    <span style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:above?"#7CFFB2":"#FF5C8A"}}>{val}</span>
                  </div>
                </div>
                {/* This game bar */}
                <div style={{marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4A5066",marginBottom:3}}>
                    <span>this game</span><span style={{color:above?"#7CFFB2":"#FF5C8A",fontWeight:700}}>{val}</span>
                  </div>
                  <div style={{height:8,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${valPct*100}%`,background:above?"#7CFFB2":"#FF5C8A",borderRadius:99,boxShadow:`0 0 8px ${above?"#7CFFB2":"#FF5C8A"}66`,transition:"width .5s cubic-bezier(.2,.8,.2,1)"}}/>
                  </div>
                </div>
                {/* Avg bar */}
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#4A5066",marginBottom:3}}>
                    <span>10-game avg</span><span style={{fontWeight:700}}>{average.toFixed(1)}</span>
                  </div>
                  <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${avgPct*100}%`,background:"rgba(139,146,168,0.5)",borderRadius:99}}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sparkline trend for each stat */}
        <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>RECENT TREND · LAST 10 GAMES</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
          {FIELDS.map(field => {
            const vals = last10.map(g => g[field]||0);
            const max = Math.max(...vals,1);
            const w=140, h=48, pad=4;
            const pts = vals.map((v,i)=>{
              const x=pad+(i/(Math.max(vals.length-1,1)))*(w-pad*2);
              const y=h-pad-(v/max)*(h-pad*2);
              return `${x},${y}`;
            }).join(" ");
            const thisVal = game[field]||0;
            const gameIdx = last10.findIndex(g=>g.id===game.id);
            const gx = gameIdx>=0 ? pad+(gameIdx/(Math.max(last10.length-1,1)))*(w-pad*2) : null;
            const gy = gameIdx>=0 ? h-pad-((thisVal)/max)*(h-pad*2) : null;
            return (
              <div key={field} style={{background:"#11131F",borderRadius:13,padding:"10px 10px 8px",border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{fontSize:9,color:"#4A5066",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>{field}</div>
                <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
                  {vals.length>1&&<polyline points={pts} fill="none" stroke={player?.color||"#B8FF4D"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>}
                  {vals.map((v,i)=>{
                    const x=pad+(i/(Math.max(vals.length-1,1)))*(w-pad*2);
                    const y=h-pad-(v/max)*(h-pad*2);
                    const isThis=last10[i]?.id===game.id;
                    return <circle key={i} cx={x} cy={y} r={isThis?4:2} fill={isThis?"#fff":player?.color||"#B8FF4D"} opacity={isThis?1:0.4}/>;
                  })}
                </svg>
                <div style={{fontSize:11,fontWeight:700,color:player?.color||"#B8FF4D",marginTop:2}}>{thisVal} <span style={{fontSize:9,color:"#4A5066",fontWeight:400}}>this game</span></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayGameGroup({ dk, games, playerColor, jumpDate, STAT_FIELDS, allStats, currentPlayer, onUpdateOpponentScore }) {
  const [open, setOpen] = useState(dk === jumpDate || false);
  const [selectedGame, setSelectedGame] = useState(null);
  const date = new Date(dk + "T00:00:00");
  const wins = games.filter(g => gameIsWin(g)).length;
  const isJump = dk === jumpDate;
  useEffect(() => { if (isJump) setOpen(true); }, [isJump]);

  const myAllGames = (allStats||[])
    .filter(g => g.playerId === currentPlayer && g.mode === games[0]?.mode)
    .sort((a,b) => new Date(a.ts)-new Date(b.ts));

  return (
    <div id={`gamelog-${dk}`} style={{marginBottom:10}}>
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          allPlayerGames={myAllGames}
          onClose={() => setSelectedGame(null)}
          onUpdateOpponentScore={onUpdateOpponentScore}
        />
      )}
      <button onClick={() => setOpen(v=>!v)} className="bb-pressable"
        style={{width:"100%",background:"#11131F",borderRadius:13,padding:"12px 14px",border:`1px solid ${isJump?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.06)"}`,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:open?6:0}}>
        <div style={{textAlign:"left"}}>
          <div style={{fontSize:12,fontWeight:700,color:playerColor}}>{fmtDay(date)}</div>
          <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{games.length} game{games.length!==1?"s":""} · {wins}W {games.length-wins}L</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,fontWeight:700,color:wins>games.length-wins?"#7CFFB2":"#FF5C8A"}}>{wins}/{games.length}</span>
          <ChevronRight size={14} color="#4A5066" style={{transform:open?"rotate(90deg)":"none",transition:"transform .2s"}}/>
        </div>
      </button>
      {open && games.map(g => {
        const won = gameIsWin(g);
        return (
          <button key={g.id} onClick={() => setSelectedGame(g)} className="bb-pressable"
            style={{width:"100%",background:"rgba(255,255,255,0.02)",borderRadius:11,padding:"11px 13px",marginBottom:6,border:`1px solid ${won?"rgba(124,255,178,0.12)":"rgba(255,92,138,0.08)"}`,textAlign:"left",cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:17,fontWeight:700}}>{formatGameScore(g)}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{fontSize:10,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A",background:won?"rgba(124,255,178,0.1)":"rgba(255,92,138,0.1)",padding:"3px 8px",borderRadius:99}}>{won?"WIN":"LOSS"}</div>
                <div style={{fontSize:10,color:"#4A5066"}}>{fmtRelTime(g.ts)}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:10}}>
              {STAT_FIELDS.map(f=>(
                <div key={f} style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#4A5066",fontWeight:700,marginBottom:2,textTransform:"uppercase"}}>{f}</div>
                  <div style={{fontSize:13,fontWeight:700,color:playerColor}}>{g[f]}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:9,color:"#4A5066",marginTop:6}}>tap for full breakdown →</div>
          </button>
        );
      })}
    </div>
  );
}


function ModeGamesSection({ stats, currentPlayer, playerColor, STAT_FIELDS, onUpdateOpponentScore }) {
  const [openModes, setOpenModes] = useState({ "2v2": true, "1v1": true });
  const toggleMode = (mode) => setOpenModes(prev => ({ ...prev, [mode]: !prev[mode] }));

  const renderModeGames = (mode) => {
    if (mode === "2v2") {
      const groups = getSessionGroups(stats).filter(g => g.mode === "2v2");
      if (!groups.length) {
        return <EmptyState icon="🎮" title="No 2v2 games synced yet" body="Use Sync Match to pull a live ranked 2v2 game for the duo you played with." />;
      }
      return groups.map((grp, idx) => {
        const duoIds = [...new Set(grp.games.flatMap(g => g.duoIds || [g.playerId]).filter(Boolean))];
        const duoNames = duoIds.map(id => PLAYERS.find(p => p.id === id)?.name).filter(Boolean).join(" + ") || "duo";
        return <SessionGroupCard key={`${grp.code}_${grp.mode}_${grp.ts}`} session={grp} allStats={stats} gameLabel={`${duoNames} · GAME ${groups.length - idx}`} onUpdateOpponentScore={onUpdateOpponentScore} />;
      });
    }

    const myGames = (stats || [])
      .filter(g => g.mode === "1v1" && g.playerId === currentPlayer)
      .sort((a,b) => new Date(b.ts) - new Date(a.ts));

    if (!myGames.length) {
      return <EmptyState icon="⚔️" title="No 1v1 games synced yet" body="Use Sync Match to pull your latest ranked duel live from Tracker." />;
    }

    const dayMap = {};
    myGames.forEach(g => {
      const dk = dateKey(new Date(g.ts));
      if (!dayMap[dk]) dayMap[dk] = [];
      dayMap[dk].push(g);
    });

    return Object.entries(dayMap)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .map(([dk, dayGames]) => (
        <DayGameGroup key={dk} dk={dk} games={dayGames} playerColor={playerColor} jumpDate={null} STAT_FIELDS={STAT_FIELDS} allStats={stats} currentPlayer={currentPlayer} onUpdateOpponentScore={onUpdateOpponentScore}/>
      ));
  };

  return (
    <div>
      {["2v2", "1v1"].map(mode => {
        const isOpen = !!openModes[mode];
        const count = mode === "2v2" ? getSessionGroups(stats).filter(g => g.mode === "2v2").length : (stats || []).filter(g => g.mode === mode && g.playerId === currentPlayer).length;
        return (
          <div key={mode} style={{marginBottom:12}}>
            <button onClick={() => toggleMode(mode)} className="bb-pressable"
              style={{width:"100%",background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"14px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:isOpen?8:0}}>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:13,fontWeight:900,color:mode === "2v2" ? "#FF61C1" : "#4D9EFF",letterSpacing:.5}}>{mode} dropdown</div>
                <div style={{fontSize:10.5,color:"#8B92A8",marginTop:3}}>{count} logged game{count!==1?"s":""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:10,color:"#4A5066",fontWeight:800,textTransform:"uppercase"}}>live synced</div>
                <ChevronRight size={15} color="#4A5066" style={{transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s"}} />
              </div>
            </button>
            {isOpen && renderModeGames(mode)}
          </div>
        );
      })}
    </div>
  );
}

function TeamLinkGames({ stats }) {
 const roomGames = stats.filter(g => g.roomId || g.sessionCode);
  const dayMap = {};
  roomGames.forEach(g => {
    const dk = dateKey(new Date(g.ts));
    if (!dayMap[dk]) dayMap[dk] = [];
    dayMap[dk].push(g);
  });
  const days = Object.entries(dayMap).sort((a,b) => b[0].localeCompare(a[0]));
const recentGames = roomGames
  .sort((a,b) => new Date(b.ts) - new Date(a.ts))
  .slice(0,5);                

  if (days.length === 0) {
    return <div style={s.emptyQueue}>no synced team games yet.</div>;
  }

  return (
    <div>
      {days.map(([dk, dayGames]) => {
        const sessionMap = {};
        dayGames.forEach(g => {
 const key = g.roomId || g.sessionCode;
if (!sessionMap[key]) sessionMap[key] = { code: g.roomId || g.sessionCode, mode: g.mode, games: [], ts: g.ts };
          sessionMap[key].games.push(g);
          if (new Date(g.ts) > new Date(sessionMap[key].ts)) sessionMap[key].ts = g.ts;
        });
        const sessions = Object.values(sessionMap).sort((a,b) => new Date(b.ts) - new Date(a.ts));
        return (
          <TeamLinkDayGroup key={dk} dk={dk} sessions={sessions} allStats={stats} />
        );
      })}
    </div>
  );
}

function TeamLinkDayGroup({ dk, sessions, allStats }) {
  const [open, setOpen] = useState(false);
  const date = new Date(dk + "T00:00:00");
  const totalGames = sessions.length;
  return (
    <div style={{marginBottom:10}}>
      <button onClick={() => setOpen(v=>!v)} className="bb-pressable"
        style={{width:"100%",background:"#11131F",borderRadius:13,padding:"12px 14px",border:"1px solid rgba(184,255,77,0.15)",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:open?8:0}}>
        <div style={{textAlign:"left"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#B8FF4D"}}>{fmtDay(date)}</div>
          <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{totalGames} game{totalGames!==1?"s":""}</div>
        </div>
        <ChevronRight size={14} color="#4A5066" style={{transform:open?"rotate(90deg)":"none",transition:"transform .2s"}}/>
      </button>
 {open && sessions.map((sess, idx) => (
     <SessionGroupCard key={`${sess.code}_${sess.ts}`} session={sess} allStats={allStats} gameLabel={`GAME ${sessions.length - idx}`}/>
))}
    </div>
  );
}

function TournamentOCRTab({ schedule, setSchedule, currentPlayer }) {
  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState(null); // {opponent, ourScore, theirScore, matchLabel}
  const fileRef = useRef(null);
  const isCaptain = currentPlayer === ADMIN_ID;

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    setImage(URL.createObjectURL(f));
    setParsed(null);
    setRawText("");
  };

  const parseOcrText = (text) => {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    // look for a score pattern like "3 - 1" or "3:1" or "3–1"
    let ourScore = null, theirScore = null, opponent = "";
    const scoreLine = lines.find(l => /\d+\s*[-–:]\s*\d+/.test(l));
    if (scoreLine) {
      const m = scoreLine.match(/(\d+)\s*[-–:]\s*(\d+)/);
      if (m) { ourScore = Number(m[1]); theirScore = Number(m[2]); }
    }
    // best guess for opponent name: longest non-numeric line that isn't the score line
    const nameCandidates = lines.filter(l => l !== scoreLine && /[A-Za-z]{3,}/.test(l) && !/^\d+$/.test(l));
    opponent = nameCandidates.sort((a,b) => b.length - a.length)[0] || "";
    return { opponent, ourScore, theirScore };
  };

  const runScan = async () => {
    if (!imageFile) return;
    setScanning(true);
    setProgress(0);
    try {
     const base64 = await new Promise((res) => {
  const reader = new FileReader();
  reader.onload = () => res(reader.result.split(",")[1]);
  reader.readAsDataURL(imageFile);
});

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: "Look at this Rocket League screenshot. Return ONLY a JSON object with these fields: ourScore (number), theirScore (number), opponent (string team name). No other text." }
      ]
    }]
  })
});

const data = await response.json();
const clean = data.content[0].text.replace(/```json|```/g, "").trim();
setParsed(JSON.parse(clean));
setProgress(100);
    } catch (e) {
      setRawText("scan failed — try a clearer screenshot.");
    }
    setScanning(false);
  };

  const applyToMatch = async (matchId) => {
    if (!parsed) return;
    const isPlayoff = matchId.startsWith("po");
    const key = isPlayoff ? "playoffs" : "league";
    const updated = schedule[key].map(m => m.id === matchId ? {
      ...m,
      opponent: parsed.opponent || m.opponent,
      result: (parsed.ourScore!=null && parsed.theirScore!=null) ? {
        status: parsed.ourScore > parsed.theirScore ? "win" : "loss",
        ours: parsed.ourScore,
        theirs: parsed.theirScore,
      } : m.result,
    } : m);
    const next = { ...schedule, [key]: updated };
    setSchedule(next);
    await storeSet("schedule", next);
    setParsed(null); setImage(null); setImageFile(null); setRawText("");
  };

  const upcomingMatches = [...schedule.league, ...schedule.playoffs].filter(m => !m.result);

  return (
    <div>
      <div style={{ fontSize:11, color:"#4A5066", marginBottom:16, lineHeight:1.5 }}>
        screenshot the rocket league postgame or bracket screen — this reads the score and opponent name automatically so you don't have to type it in.
      </div>

      <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display:"none" }}/>
      <button onClick={() => fileRef.current?.click()} className="bb-pressable"
        style={{ width:"100%", minHeight:160, background:"rgba(255,255,255,0.03)", border:"1px dashed rgba(255,255,255,0.15)", borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", marginBottom:14 }}>
        {image ? <img src={image} alt="screenshot" style={{ width:"100%", maxHeight:260, objectFit:"contain" }}/> : (
          <>
            <ImageIcon size={26} color="#4A5066"/>
            <span style={{ color:"#4A5066", fontSize:13, marginTop:8 }}>tap to upload a screenshot</span>
          </>
        )}
      </button>

      {image && !parsed && (
        <button onClick={runScan} disabled={scanning} className="bb-pressable bb-glow-lime"
          style={{ ...s.primaryBtn, opacity: scanning ? 0.6 : 1 }}>
          {scanning ? `scanning… ${progress}%` : "scan screenshot"}
        </button>
      )}

      {parsed && (
        <div style={{ background:"#11131F", borderRadius:14, padding:14, marginTop:14, border:"1px solid rgba(184,255,77,0.2)" }}>
          <div style={{ fontSize:11, color:"#B8FF4D", fontWeight:700, letterSpacing:0.8, marginBottom:10 }}>DETECTED RESULT</div>
          <div style={{ marginBottom:8 }}>
            <div style={s.modalLabel}>opponent</div>
            <input value={parsed.opponent} onChange={e=>setParsed(p=>({...p,opponent:e.target.value}))} style={s.modalInput}/>
          </div>
          <div style={s.modalScoreRow}>
            <div style={{flex:1}}><div style={s.modalLabel}>us</div><input type="number" value={parsed.ourScore??""} onChange={e=>setParsed(p=>({...p,ourScore:Number(e.target.value)}))} style={s.modalInput}/></div>
            <div style={{flex:1}}><div style={s.modalLabel}>them</div><input type="number" value={parsed.theirScore??""} onChange={e=>setParsed(p=>({...p,theirScore:Number(e.target.value)}))} style={s.modalInput}/></div>
          </div>

          {isCaptain ? (
            <>
              <div style={s.modalLabel}>apply to which match?</div>
              {upcomingMatches.length === 0 && <div style={{ fontSize:12, color:"#4A5066", marginTop:6 }}>no upcoming matches to apply this to.</div>}
              {upcomingMatches.map(m => (
                <button key={m.id} onClick={()=>applyToMatch(m.id)} className="bb-pressable bb-glow-lime"
                  style={{ width:"100%", textAlign:"left", background:"rgba(184,255,77,0.08)", border:"1px solid rgba(184,255,77,0.25)", borderRadius:10, padding:"10px 12px", marginTop:8, cursor:"pointer", color:"#E8ECF4", fontSize:12.5 }}>
                  {m.label} — {m.opponent || "tbd"}
                </button>
              ))}
            </>
          ) : (
            <div style={{ fontSize:12, color:"#4A5066", marginTop:10 }}>only the captain can apply this to the bracket.</div>
          )}

          <button onClick={()=>{setParsed(null);setImage(null);setImageFile(null);setRawText("");}} className="bb-pressable"
            style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"9px 0", fontSize:11.5, color:"#8B92A8", cursor:"pointer", marginTop:10 }}>
            scan another
          </button>
        </div>
      )}

      {rawText && !parsed?.opponent && (
        <div style={{ fontSize:10.5, color:"#3A4256", marginTop:14, fontFamily:"monospace", whiteSpace:"pre-wrap" }}>{rawText.slice(0,300)}</div>
      )}
    </div>
  );
}



function getNextAutoGameSessionCode(stats) {
  const nums = (stats || [])
    .map(g => String(g.sessionCode || "").match(/^game\s+(\d+)$/i))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `game ${next}`;
}

async function fetchLatestParseMatchForPlayer(player, playlist) {
  const res = await fetch(
    `https://api.parse.bot/scraper/d0dcf8e8-3a72-4b21-bffb-8fa735257835/get_player_sessions?platform=${player.platform}&username=${player.name}`,
    { headers: { "X-API-Key": "pmx_8a6e026a59120911628f4faf9ff66847" } }
  );
  const json = await res.json();
  const sessions = json?.data?.items || [];
  const matches = sessions.flatMap(s => s.matches || []);
  return matches
    .filter(match => match?.metadata?.playlist === playlist && match?.metadata?.isGrouped === false)
    .sort((a,b)=>new Date(b.metadata.dateCollected)-new Date(a.metadata.dateCollected))[0];
}


function getMatchRatingDelta(match) {
  const candidates = [
    match?.stats?.rating?.metadata?.ratingDelta,
    match?.stats?.rating?.metadata?.delta,
    match?.stats?.rating?.metadata?.change,
    match?.stats?.rating?.delta,
    match?.stats?.mmr?.metadata?.ratingDelta,
    match?.metadata?.ratingDelta,
    match?.metadata?.mmrDelta,
  ];
  for (const val of candidates) {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
  }
  const current = Number(match?.stats?.rating?.value);
  const previous = Number(
    match?.stats?.rating?.metadata?.previousRating ??
    match?.stats?.rating?.metadata?.before ??
    match?.stats?.rating?.metadata?.oldValue
  );
  if (Number.isFinite(current) && Number.isFinite(previous)) return current - previous;
  return 0;
}

function parseGameToStatEntry({ sessionCode, player, match, mode, result }) {
  return {
    id: `${sessionCode}_${player.id}_${match.id}`,
    parseMatchId: match.id,
    playerId: player.id,
    mode,
    ts: match.metadata.dateCollected,
    roomId: sessionCode,
    sessionCode,
    goals: match.stats?.goals?.value || 0,
    assists: match.stats?.assists?.value || 0,
    saves: match.stats?.saves?.value || 0,
    shots: match.stats?.shots?.value || 0,
    demos: 0,
    score: match.stats?.score?.value || 0,
    ourScore: match.stats?.goals?.value || 0,
    theirScore: null,
    opponentScoreManual: false,
    result,
    rating: match.stats?.rating?.value || null,
    ratingDelta: getMatchRatingDelta(match),
    source: "parse_sessions",
  };
}

function TeamRoomModal({ currentPlayer, stats, setStats, teamRoom, setTeamRoom, onClose, addToast }) {
  const [mode, setMode] = useState("3v3");
const [loggingInRoom, setLoggingInRoom] = useState(false);   
const [roomSyncing, setRoomSyncing] = useState(false);
const [roomSyncMsg, setRoomSyncMsg] = useState("");                
const openRoom = async () => {
  const room = {
    id: Date.now().toString(),
    mode,
    playlist:
      mode === "1v1" ? "Ranked Duel 1v1" :
      mode === "2v2" ? "Ranked Doubles 2v2" :
      "Ranked Standard 3v3",
    players:
      mode === "1v1" ? [currentPlayer] :
      mode === "2v2" ? ["p1", currentPlayer].filter((v, i, a) => a.indexOf(v) === i) :
      PLAYERS.map(p => p.id),
    createdBy: currentPlayer,
    createdAt: new Date().toISOString(),
    games: []
  };

  setTeamRoom(room);
  await storeSet("team_room", room);
};
  const closeRoom = async () => {
    setTeamRoom(null);
    await storeSet("team_room", { closed: true, closedAt: new Date().toISOString() });
    onClose();
  };
  const roomGames = teamRoom ? stats.filter(g => g.roomId === teamRoom.id) : [];
  const byPlayer = PLAYERS.map(p => ({ player: p, game: roomGames.find(g => g.playerId === p.id) }));

                
const fetchLatest3v3ForPlayer = async (player, roomOpenedAt) => {
  const platform = player.platform;

  const res = await fetch(
    `https://api.parse.bot/scraper/d0dcf8e8-3a72-4b21-bffb-8fa735257835/get_player_sessions?platform=${platform}&username=${player.name}`,
    { headers: { "X-API-Key": "pmx_8a6e026a59120911628f4faf9ff66847" } }
  );

  const json = await res.json();
  const sessions = json?.data?.items || [];
const matches = sessions.flatMap(s => s.matches || []);

  
return matches
  .filter(match =>
    match?.metadata?.playlist === teamRoom.playlist &&
    match?.metadata?.isGrouped === false
  )
  .sort(
    (a, b) =>
      new Date(b.metadata.dateCollected) -
      new Date(a.metadata.dateCollected)
  )[0];
  
  
};

const syncRoomFromParse = async () => {
  if (!teamRoom || roomSyncing) return;

  setRoomSyncing(true);
  setRoomSyncMsg("checking tracker…");

  try {
    const pulled = await Promise.all(
      PLAYERS
  .filter(p => teamRoom.players.includes(p.id))
  .map(async (p) => ({
        player: p,
        match: await fetchLatest3v3ForPlayer(p, teamRoom.createdAt),
      }))
    );
    
    
    console.log("========== PULLED ==========");
console.log(pulled);
    console.log("MATCHS FOUND:", pulled.map(x => ({
  player: x.player.name,
  found: !!x.match,
  match: x.match
})));
    

    if (pulled.some(x => !x.match)) {
      setRoomSyncMsg("waiting for all 3 matches to show on tracker…");
      setRoomSyncing(false);
      return;
    }

    const times = pulled.map(x => new Date(x.match.metadata.dateCollected).getTime());
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    
    console.log("MATCH DATES:", pulled.map(x => ({
  player: x.player.name,
  date: x.match.metadata.dateCollected,
  result: x.match.metadata.result,
  id: x.match.id
})));
    
    
    const within10Min = maxTime - minTime <= 10 * 60 * 1000;
    console.log("WITHIN 10 MIN:", within10Min);

    const results = pulled.map(x => x.match.metadata.result);
    const sameResult = results.every(r => r === results[0]);
    console.log("SAME RESULT:", sameResult);
console.log("RESULTS:", results);

 if (!within10Min) {
      setRoomSyncMsg("found 3 games, but they don't look like the same match yet");
      setRoomSyncing(false);
      return;
    }

    const alreadyImported = pulled.some(x =>
      stats.some(g => g.parseMatchId === x.match.id && g.playerId === x.player.id)
    );

    if (alreadyImported) {
      setRoomSyncMsg("that match was already imported");
      setRoomSyncing(false);
      return;
    }

    const result = pulled[0].match.metadata.result;
    const isWin = result === "victory";
    
    console.log("STARTING IMPORT");

    const autoSessionCode = getNextAutoGameSessionCode(stats);
    let importedGames = pulled.map(({ player, match }) => parseGameToStatEntry({
      sessionCode: autoSessionCode,
      player,
      match,
      mode: teamRoom.mode,
      result,
    }));
    importedGames = applySyncedTeamScores(importedGames, result);

    const updStats = [...importedGames, ...stats];
    
    console.log("SUCCESS!");
console.log(updStats);
    
    setStats(updStats);
    await storeSet("stats", updStats);

    setTeamRoom(null);
    await storeSet("team_room", { closed: true, closedAt: new Date().toISOString() });

    addToast?.(`${teamRoom.mode} match synced + room closed`, "✅");
    onClose();
  } catch (e) {
    console.error(e);
    setRoomSyncMsg("sync failed — try again");
  }

  setRoomSyncing(false);
};                
                
                
const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

  const handleTouchStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (dx > 0 && dx > dy) setSwipeOffset(dx);
  };
  const handleTouchEnd = () => {
    if (swipeOffset > 80) { onClose(); setSwipeOffset(0); }
    else setSwipeOffset(0);
  };
             
              
  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position:"fixed", inset:0, zIndex:400, background:"#040818",
        display:"flex", flexDirection:"column",
        animation:"scaleFadeIn .3s cubic-bezier(.2,.8,.2,1)",
        transform:`translateX(${swipeOffset}px)`,
        opacity: Math.max(0, 1 - swipeOffset / 400),
        transition: swipeOffset === 0 ? "transform .3s cubic-bezier(.25,.46,.45,.94)" : "none",
      }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px",paddingTop:"max(16px,env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
        <button onClick={onClose} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer"}}><ChevronLeft size={18}/></button>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600}}>team room</div>
        <button onClick={onClose} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer"}}><X size={20}/></button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
        {!teamRoom ? (
          <>
            <div style={{fontSize:12,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>open a room and everyone on the team can log their stats for the same game — no session codes needed. the room stays open until you close it.</div>
            <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:8}}>GAME MODE</div>
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              {["3v3","2v2","1v1"].map(m => (
                <button key={m} onClick={() => setMode(m)} className="bb-pressable"
                  style={{flex:1,background:mode===m?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:10,padding:"11px 0",fontSize:13,fontWeight:700,color:mode===m?"#06070D":"#8B92A8",cursor:"pointer"}}>
                  {m}
                </button>
              ))}
            </div>
            <button onClick={openRoom} className="bb-pressable bb-glow-lime" style={{width:"100%",background:"#B8FF4D",border:"none",borderRadius:12,padding:"14px 0",fontSize:14,fontWeight:700,color:"#06070D",cursor:"pointer"}}>
              open {mode} room
            </button>
          </>
        ) : (
          <>
      <div style={{background:"linear-gradient(135deg,rgba(184,255,77,0.1),rgba(184,255,77,0.04))",border:"1px solid rgba(184,255,77,0.3)",borderRadius:16,padding:"16px",marginBottom:20,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#B8FF4D",fontWeight:700,letterSpacing:1,marginBottom:4}}>ROOM OPEN · {(teamRoom?.mode || "3v3").toUpperCase()}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:700,color:"#E8ECF4",letterSpacing:4,margin:"10px 0"}}>{(teamRoom?.id || "ROOM").slice(-4).toUpperCase()}</div>
              <div style={{fontSize:10,color:"#4A5066",marginBottom:8}}>ROOM CODE</div>
              <div style={{fontSize:11,color:"#8B92A8",marginBottom:2}}>opened by {PLAYERS.find(p=>p.id===teamRoom.createdBy)?.name} · {fmtRelTime(teamRoom.createdAt)}</div>
              <div style={{fontSize:11,color:"#4A5066",marginTop:6}}>logged games sync automatically to the team link tab</div>
            </div>
              
              
            <button
  onClick={syncRoomFromParse}
  disabled={roomSyncing}
  className="bb-pressable bb-glow-lime"
  style={{
    width:"100%",
    background:"#B8FF4D",
    border:"none",
    borderRadius:12,
    padding:"13px 0",
    fontSize:13,
    fontWeight:700,
    color:"#06070D",
    cursor:"pointer",
    marginBottom:10,
    opacity: roomSyncing ? 0.6 : 1
  }}
>
 {roomSyncing ? "checking tracker…" : `sync latest ${teamRoom.mode} match`}
</button>

{roomSyncMsg && (
  <div style={{fontSize:11,color:"#8B92A8",textAlign:"center",marginBottom:12}}>
    {roomSyncMsg}
  </div>
)}  
              
              
            <div style={{fontSize:11,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:12}}>LOGGED SO FAR</div>
            {byPlayer.map(({player, game}) => (
              <div key={player.id} style={{background:"#11131F",borderRadius:13,padding:"13px 14px",marginBottom:8,border:`1px solid ${game?player.color+"33":"rgba(255,255,255,0.05)"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:game?10:0}}>
                  <div style={{width:8,height:8,borderRadius:99,background:game?player.color:"#2E3346"}}/>
                  <span style={{fontSize:13,fontWeight:700,color:game?player.color:"#4A5066"}}>{player.name}</span>
                  {!game && <span style={{fontSize:11,color:"#4A5066",fontStyle:"italic",marginLeft:"auto"}}>hasn't logged yet</span>}
                </div>
                {game && (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                    {["goals","assists","saves","shots","demos"].map(f => (
                      <div key={f} style={{textAlign:"center",background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"6px 2px"}}>
                        <div style={{fontSize:9,color:"#4A5066",fontWeight:700,marginBottom:2,textTransform:"uppercase"}}>{f.slice(0,3)}</div>
                        <div style={{fontSize:14,fontWeight:700,color:player.color}}>{game[f]||0}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
         {!roomGames.find(g => g.playerId === currentPlayer) && (() => {
  const fiveMinAgo = Date.now() - 60 * 60 * 1000;
  const recentGame = stats
    .filter(g => g.playerId === currentPlayer && g.mode === teamRoom.mode && new Date(g.ts).getTime() > fiveMinAgo)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
  const alreadyLinked = recentGame && roomGames.find(g => g.id === recentGame.id);

  if (alreadyLinked) return (
    <div style={{background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"12px",marginTop:8,textAlign:"center",fontSize:12,color:"#4A5066"}}>
      already logged this game
    </div>
  );

  if (recentGame) return (
    <button onClick={async () => {
  const autoSessionCode = getNextAutoGameSessionCode(stats);
  const withRoom = { ...recentGame, roomId: autoSessionCode, sessionCode: autoSessionCode };
  const updStats = stats.map(g => g.id === recentGame.id ? withRoom : g);
  await storeSet("stats", updStats);
  setStats(updStats);

  // Check if all 3 players have now logged — and scores all match
  const roomEntries = updStats.filter(g => g.roomId === teamRoom.id);
  const allIn = PLAYERS.every(p => roomEntries.find(g => g.playerId === p.id));
  if (allIn) {
    const scores = roomEntries.map(g => `${g.ourScore}-${g.theirScore}`);
    const allMatch = scores.every(s => s === scores[0]);
    if (allMatch) {
      // Auto-close the room
      setTeamRoom(null);
      await storeSet("team_room", { closed: true, closedAt: new Date().toISOString() });
    }
  }
}} className="bb-pressable bb-glow-lime" style={{width:"100%",background:"#B8FF4D",border:"none",borderRadius:12,padding:"13px 0",fontSize:13,fontWeight:700,color:"#06070D",cursor:"pointer",marginTop:8}}>
      link my last {teamRoom.mode} game ({recentGame.ourScore}–{recentGame.theirScore})
    </button>
  );

  return (
    <div style={{background:"rgba(255,255,255,0.03)",border:"1px dashed rgba(255,255,255,0.1)",borderRadius:12,padding:"12px",marginTop:8,textAlign:"center",fontSize:12,color:"#4A5066"}}>
      no recent {teamRoom.mode} game found — log one in the stats tab first
    </div>
  );
})()}
            {teamRoom.createdBy === currentPlayer && (
              <button onClick={closeRoom} className="bb-pressable" style={{width:"100%",background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:12,padding:"13px 0",fontSize:13,fontWeight:700,color:"#FF5C8A",cursor:"pointer",marginTop:10}}>
                close room
              </button>
            )}
{loggingInRoom && (
  <LogGameModal mode={teamRoom.mode} currentPlayer={currentPlayer} onSave={async (entry) => {
    const autoSessionCode = getNextAutoGameSessionCode(stats);
    const withRoom = { ...entry, roomId: autoSessionCode, sessionCode: autoSessionCode };
    const updStats = [withRoom, ...stats];
    await storeSet("stats", updStats);
    setStats(updStats);
  }} onClose={() => setLoggingInRoom(false)} />
)}
          </>
        )}
      </div>
    </div>
  );
}


function StatsTab({ stats, setStats, currentPlayer, passXP, setPassXP, jumpDate, onJumpHandled, schedule, setSchedule, teamRoom, setTeamRoom, mmrProfiles, setMmrProfiles, addToast, useParseCredit }) {
  const [mode,setMode]=useState("2v2");
  const [logging,setLogging]=useState(false);
  const [showAllGames, setShowAllGames]=useState(false);
  const [statsSubTab, setStatsSubTab] = useState("tracker");
const [showRoom, setShowRoom] = useState(false);
const [matchSyncing, setMatchSyncing] = useState(false);
const [showSyncMatchModal, setShowSyncMatchModal] = useState(false);
const [syncMode, setSyncMode] = useState(currentPlayer === ADMIN_ID ? "3v3" : "2v2");
const [selectedDuoIds, setSelectedDuoIds] = useState(["p1","p2"]);
const syncPanelSwipe = useSwipeRightToClose(() => setShowSyncMatchModal(false));
const visibleSyncModes = currentPlayer === ADMIN_ID ? ["3v3","2v2","1v1"] : ["2v2","1v1"];
useEffect(() => {
  if (currentPlayer !== ADMIN_ID && syncMode === "3v3") setSyncMode("2v2");
}, [currentPlayer, syncMode]);
useEffect(() => {
  if (!stats?.length) return;
  const groupedScores = {};
  stats.forEach(g => {
    if (g?.source !== "parse_sessions") return;
    if (!g.sessionCode) return;
    if (!groupedScores[g.sessionCode]) groupedScores[g.sessionCode] = 0;
    groupedScores[g.sessionCode] += Number(g.goals) || 0;
  });
  let changed = false;
  const normalized = stats.map(g => {
    if (g?.source !== "parse_sessions") return g;
    const nextOurScore = g.sessionCode ? (groupedScores[g.sessionCode] ?? (Number(g.goals) || 0)) : (Number(g.goals) || 0);
    const nextTheirScore = g.opponentScoreManual ? g.theirScore : null;
    if (g.ourScore === nextOurScore && g.theirScore === nextTheirScore) return g;
    changed = true;
    return { ...g, ourScore: nextOurScore, theirScore: nextTheirScore, opponentScoreManual: !!g.opponentScoreManual };
  });
  if (changed) {
    setStats(normalized);
    storeSet("stats", normalized);
  }
}, [stats?.length]);
useEffect(() => {
  if (jumpDate) {
    setMode("2v2");
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
  const pointsMult = isEventActive("double_points") ? 2 : 1;
  cur+=2*pointsMult;
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
const todayWins = upd.filter(g => g.mode === "3v3" && g.playerId === currentPlayer && dateKey(new Date(g.ts)) === todayDk && g.result === "victory");
const allTodayGames = upd.filter(g => g.mode === "3v3" && dateKey(new Date(g.ts)) === todayDk);
let streak = 0;
for (let i = allTodayGames.length - 1; i >= 0; i--) {
if (allTodayGames[i].result === "victory") streak++;
  else break;
}
const heatMult = heatMultiplier(streak) * (isEventActive("heat_surge") ? 1.5 : 1);
const eventMult = isEventActive("double_xp") ? 2 : 1;
const statBonus = (isEventActive("assist_week") && (entry.assists||0) >= 2) ? 1.5
  : (isEventActive("save_week") && (entry.saves||0) >= 3) ? 1.5
  : 1;
const finalMult = mult * heatMult * eventMult * statBonus;
const updXP={...pxp,[currentPlayer]:(pxp[currentPlayer]||0)+2*finalMult};
  setPassXP(updXP); await storeSet("pass_xp",updXP);
};
const updateOpponentScore = async (game, theirScoreValue) => {
  const val = Number(theirScoreValue);
  if (!Number.isFinite(val)) return;
  const upd = stats.map(g => {
    const sameGroupedGame = game.mode === "2v2" && g.mode === game.mode && g.sessionCode && game.sessionCode && g.sessionCode === game.sessionCode;
    const sameSingleGame = g.id === game.id;
    if (!sameGroupedGame && !sameSingleGame) return g;
    return { ...g, theirScore: val, opponentScoreManual: true };
  });
  setStats(upd);
  await storeSet("stats", upd);
  addToast?.("opponent score saved", "✅");
};
  const modeGames=stats.filter(g=>g.mode===mode);
  const myGames=modeGames.filter(g=>g.playerId===currentPlayer).sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  const avg=(arr,field)=>arr.length?(arr.reduce((s,g)=>s+(Number(g[field])||0),0)/arr.length).toFixed(1):"—";
  const winRate=(arr)=>{ if(!arr.length)return"—"; return Math.round((arr.filter(g=>gameIsWin(g)).length/arr.length)*100)+"%"; };
  const playerColor=PLAYERS.find(p=>p.id===currentPlayer)?.color||"#B8FF4D";
  const recentMyGames = [...myGames].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,5).sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  const syncDuoOptions = [
    ["p1","p2"],
    ["p1","p3"],
    ["p2","p3"],
  ];

  const syncLatestTeamMatch = async (requestedMode = syncMode, requestedPlayers = null) => {
    if (matchSyncing) return;

    const playlistByMode = {
      "3v3": "Ranked Standard 3v3",
      "2v2": "Ranked Doubles 2v2",
      "1v1": "Ranked Duel 1v1",
    };

    let playersToSync = requestedPlayers;
    if (!playersToSync) {
      playersToSync =
        requestedMode === "3v3" ? PLAYERS :
        requestedMode === "2v2" ? PLAYERS.filter(p => selectedDuoIds.includes(p.id)) :
        PLAYERS.filter(p => p.id === currentPlayer);
    }

    if (requestedMode === "3v3" && currentPlayer !== ADMIN_ID) {
      addToast?.("only the captain can sync full team 3v3", "🔒");
      return;
    }

    if (requestedMode === "2v2" && currentPlayer !== ADMIN_ID && !playersToSync.some(p => p.id === currentPlayer)) {
      addToast?.("pick a duo you played in", "⚠️");
      return;
    }

    const playlist = playlistByMode[requestedMode] || "Ranked Standard 3v3";
    const creditsNeeded = playersToSync.length;

    if (useParseCredit) {
      for (let i = 0; i < creditsNeeded; i++) {
        const creditOk = await useParseCredit(currentPlayer);
        if (!creditOk) return;
      }
    }

    setMatchSyncing(true);
    addToast?.(`syncing latest ${requestedMode} match…`, "🔄");

    try {
      const pulled = await Promise.all(
        playersToSync.map(async (p) => ({
          player: p,
          match: await fetchLatestParseMatchForPlayer(p, playlist),
        }))
      );

      if (pulled.some(x => !x.match)) {
        addToast?.(`waiting for ${playersToSync.length === 1 ? "your" : "all player"} ${requestedMode} match${playersToSync.length === 1 ? "" : "es"} to show on tracker`, "⏳");
        setMatchSyncing(false);
        return;
      }

      if (playersToSync.length > 1) {
        const times = pulled.map(x => new Date(x.match.metadata.dateCollected).getTime());
        if (Math.max(...times) - Math.min(...times) > 10 * 60 * 1000) {
          addToast?.(`latest games don't look like the same ${requestedMode} match yet`, "⚠️");
          setMatchSyncing(false);
          return;
        }

        const results = pulled.map(x => x.match.metadata.result);
        const sameResult = results.every(r => r === results[0]);
        if (!sameResult) {
          addToast?.(`latest ${requestedMode} results do not match yet`, "⚠️");
          setMatchSyncing(false);
          return;
        }
      }

      const alreadyImported = pulled.some(x =>
        stats.some(g => g.parseMatchId === x.match.id && g.playerId === x.player.id)
      );

      if (alreadyImported) {
        addToast?.("that match was already synced", "✅");
        setMatchSyncing(false);
        return;
      }

      const result = pulled[0].match.metadata.result;
      const sessionCode = getNextAutoGameSessionCode(stats);
      let importedGames = pulled.map(({ player, match }) =>
        parseGameToStatEntry({ sessionCode, player, match, mode: requestedMode, result })
      );
      importedGames = applySyncedTeamScores(importedGames, result);

      const updStats = [...importedGames, ...stats];
      setStats(updStats);
      await storeSet("stats", updStats);
      addToast?.(`${sessionCode} ${requestedMode} synced from tracker`, "✅");
      setTimeout(() => setShowSyncMatchModal(false), 350);
    } catch(e) {
      console.error(e);
      addToast?.("sync match failed", "❌");
    }

    setMatchSyncing(false);
  };
return (
    <div className="bb-tab-content" style={s.tabContent}>
      {logging&&<LogGameModal mode={mode} currentPlayer={currentPlayer} onSave={saveGame} onClose={()=>setLogging(false)}/>}
<div style={s.sectionRowHeader}>
        <div style={s.sectionLabel}>stats tracker</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={async () => {
          const creditOk = useParseCredit ? await useParseCredit(currentPlayer) : true;
          if (!creditOk) return;
          const profile = mmrProfiles?.[currentPlayer];
          if (!profile) return;
          addToast?.("syncing…", "🔄");
          try {
            const res = await fetch(
             `https://api.parse.bot/scraper/d0dcf8e8-3a72-4b21-bffb-8fa735257835/get_player_profile?platform=${profile.platform}&username=${profile.handle}`,
              { headers: { "X-API-Key": "pmx_8a6e026a59120911628f4faf9ff66847" } }
            );
            const json = await res.json();
            const segments = json?.data?.segments || [];
            const newRanks = profile.ranks.map(r => {
              const seg = segments.find(s => s.type === "playlist" && s.metadata?.name === r.playlist);
              const newMmr = seg?.stats?.rating?.value || r.mmr;
              const newRankName = seg?.stats?.tier?.metadata?.name || "Unranked";
              return { ...r, prevMmr:r.mmr, prevRank:r.rank, mmr:newMmr, rank:newRankName, division:seg?.stats?.division?.metadata?.name || "" };
            });
            const updated = { ...profile, ranks: newRanks, lastSynced: new Date().toISOString() };
            setMmrProfiles(prev => ({ ...prev, [currentPlayer]: updated }));
            await setMMR(currentPlayer, updated);
            addToast?.("ranks updated!", "✅");
          } catch(e) { addToast?.("sync failed", "❌"); }
        }} className="bb-pressable bb-glow-lime" style={s.newPostBtn}>
          sync ranks
        </button>
        </div>
      </div>

      {showSyncMatchModal && (
        <div {...syncPanelSwipe.swipeHandlers} style={{position:"fixed",inset:0,zIndex:600,background:"#06070D",overflowY:"auto",padding:"18px",paddingTop:"max(18px, env(safe-area-inset-top))",paddingBottom:"max(24px, env(safe-area-inset-bottom))",...syncPanelSwipe.swipeStyle}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div>
              <div style={{fontSize:11,color:"#B8FF4D",fontWeight:900,letterSpacing:1}}>SYNC MATCH</div>
              
            </div>
            <button onClick={()=>setShowSyncMatchModal(false)} className="bb-pressable" style={{width:38,height:38,borderRadius:12,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.05)",color:"#E8ECF4",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <X size={18}/>
            </button>
          </div>

          <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:18,padding:14,marginBottom:14}}>
            <div style={{fontSize:10,color:"#4A5066",fontWeight:800,letterSpacing:1,marginBottom:10}}>MODE</div>
            <div style={{display:"grid",gridTemplateColumns:`repeat(${visibleSyncModes.length},1fr)`,gap:8}}>
              {visibleSyncModes.map(m => (
                <button key={m} onClick={()=>setSyncMode(m)} className="bb-pressable" style={{
                  background:syncMode===m?"#B8FF4D":"rgba(255,255,255,0.05)",
                  border:syncMode===m?"none":"1px solid rgba(255,255,255,0.08)",
                  borderRadius:12,
                  padding:"11px 0",
                  color:syncMode===m?"#06070D":"#8B92A8",
                  fontSize:13,
                  fontWeight:900,
                  cursor:"pointer"
                }}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {syncMode === "3v3" && (
            <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:18,padding:16,marginBottom:14}}>
              <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900,letterSpacing:1,marginBottom:6}}>FULL TEAM 3V3</div>
              <div style={{fontSize:13,color:"#E8ECF4",fontWeight:800,marginBottom:6}}>maglvxx · apcards5 · tqr11le</div>
              <div style={{fontSize:11,color:"#8B92A8",lineHeight:1.45,marginBottom:14}}>Captain-only. Pulls the latest ranked 3v3 match for all three players and groups it as the next Team Link game.</div>
              <button
                disabled={matchSyncing || currentPlayer !== ADMIN_ID}
                onClick={()=>syncLatestTeamMatch("3v3", PLAYERS)}
                className="bb-pressable bb-glow-lime"
                style={{width:"100%",background:currentPlayer===ADMIN_ID?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:13,padding:"12px 0",fontSize:13,fontWeight:900,color:currentPlayer===ADMIN_ID?"#06070D":"#4A5066",cursor:currentPlayer===ADMIN_ID?"pointer":"not-allowed",opacity:matchSyncing?0.6:1}}
              >
                {matchSyncing ? "syncing…" : "sync full team 3v3 · uses 3 credits"}
              </button>
            </div>
          )}

          {syncMode === "2v2" && (
            <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(167,139,250,0.18)",borderRadius:18,padding:16,marginBottom:14}}>
              <div style={{fontSize:10,color:"#A78BFA",fontWeight:900,letterSpacing:1,marginBottom:10}}>SELECT DUO</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
                {syncDuoOptions.map(ids => {
                  const selected = ids.join("_") === selectedDuoIds.join("_");
                  const label = ids.map(id => PLAYERS.find(p => p.id === id)?.name).join(" + ");
                  return (
                    <button key={ids.join("_")} onClick={()=>setSelectedDuoIds(ids)} className="bb-pressable" style={{
                      width:"100%",
                      background:selected?"rgba(167,139,250,0.16)":"rgba(255,255,255,0.04)",
                      border:`1px solid ${selected?"rgba(167,139,250,0.45)":"rgba(255,255,255,0.08)"}`,
                      borderRadius:13,
                      padding:"12px",
                      color:selected?"#E8ECF4":"#8B92A8",
                      textAlign:"left",
                      fontSize:13,
                      fontWeight:800,
                      cursor:"pointer"
                    }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div style={{fontSize:11,color:"#8B92A8",lineHeight:1.45,marginBottom:14}}>Only the selected duo gets pulled from ranked 2v2, so the app knows exactly which chemistry pair to update.</div>
              <button
                disabled={matchSyncing}
                onClick={()=>syncLatestTeamMatch("2v2", PLAYERS.filter(p => selectedDuoIds.includes(p.id)))}
                className="bb-pressable bb-glow-violet"
                style={{width:"100%",background:"#A78BFA",border:"none",borderRadius:13,padding:"12px 0",fontSize:13,fontWeight:900,color:"#06070D",cursor:"pointer",opacity:matchSyncing?0.6:1}}
              >
                {matchSyncing ? "syncing…" : "sync selected duo · uses 2 credits"}
              </button>
            </div>
          )}

          {syncMode === "1v1" && (
            <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(77,158,255,0.18)",borderRadius:18,padding:16,marginBottom:14}}>
              <div style={{fontSize:10,color:"#4D9EFF",fontWeight:900,letterSpacing:1,marginBottom:6}}>MY 1V1</div>
              <div style={{fontSize:13,color:"#E8ECF4",fontWeight:800,marginBottom:6}}>{PLAYERS.find(p=>p.id===currentPlayer)?.name}</div>
              <div style={{fontSize:11,color:"#8B92A8",lineHeight:1.45,marginBottom:14}}>Anyone can sync their own ranked 1v1 when they are logged in. This uses the least credits because it only pulls one player.</div>
              <button
                disabled={matchSyncing}
                onClick={()=>syncLatestTeamMatch("1v1", PLAYERS.filter(p => p.id === currentPlayer))}
                className="bb-pressable bb-glow-lime"
                style={{width:"100%",background:"#4D9EFF",border:"none",borderRadius:13,padding:"12px 0",fontSize:13,fontWeight:900,color:"#06070D",cursor:"pointer",opacity:matchSyncing?0.6:1}}
              >
                {matchSyncing ? "syncing…" : "sync my 1v1 · uses 1 credit"}
              </button>
            </div>
          )}

          <div style={{fontSize:11,color:"#4A5066",lineHeight:1.5}}>
            The app skips duplicates, checks that multi-player matches happened close together, and saves the result as Game 1, Game 2, Game 3, etc.
          </div>
        </div>
      )}

      <button onClick={()=>{ if (currentPlayer !== ADMIN_ID && syncMode === "3v3") setSyncMode("2v2"); setShowSyncMatchModal(true); }} className="bb-pressable bb-glow-lime" style={{width:"100%",background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(184,255,77,0.18)",borderRadius:18,padding:"16px",marginBottom:14,textAlign:"left",cursor:"pointer",boxShadow:"0 12px 26px rgba(0,0,0,0.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontSize:10,color:"#B8FF4D",fontWeight:900,letterSpacing:1,marginBottom:4}}>SYNC MATCH</div>
          </div>
          <ChevronRight size={18} color="#B8FF4D" style={{flexShrink:0}}/>
        </div>
      </button>

<div style={{display:"flex",gap:8,marginBottom:18}}>
{[{id:"tracker",label:"stats"},{id:"teamlink",label:"team link"},{id:"mmr",label:"mmr"}].map(sub=>(
  <button key={sub.id} onClick={()=>setStatsSubTab(sub.id)} className="bb-pressable"
    style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:statsSubTab===sub.id?"#B8FF4D":"rgba(255,255,255,0.05)",color:statsSubTab===sub.id?"#06070D":"#8B92A8"}}>
    {sub.label}
  </button>
))}
</div>
{statsSubTab==="mmr" ? (
  <LiveMMRFeed mmrProfiles={mmrProfiles} />
) : statsSubTab==="teamlink" ? (
  <div>
    <div style={{...s.sectionLabel,marginBottom:10}}>team link</div>
    <TeamLinkGames stats={stats} />
  </div>
) : (
      <>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        {STAT_MODES.map(m=>(
          <button key={m} onClick={()=>setMode(m)} className="bb-pressable"
            style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:mode===m?"#B8FF4D":"rgba(255,255,255,0.05)",color:mode===m?"#06070D":"#8B92A8"}}>
            {m}
          </button>
        ))}
      </div>
      <div style={{...s.sectionLabel,marginBottom:10}}>your averages · last {Math.min(5,myGames.length)} games</div>
      {myGames.length===0 ? (
        <div style={s.emptyQueue}>no {mode} games logged yet — tap log game to add one.</div>
      ) : (
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            {STAT_FIELDS.map(f=>(
              <div key={f} style={{background:"#11131F",borderRadius:18,padding:"16px",border:"2px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:6,textTransform:"uppercase"}}>{f}</div>
                <div style={{fontSize:22,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:playerColor,marginBottom:6}}>{avg(recentMyGames,f)}</div>
                <StatsTrendLine games={recentMyGames} field={f} color={playerColor}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            <div style={{flex:1,background:"#11131F",borderRadius:18,padding:"16px",border:"2px solid rgba(255,255,255,0.08)",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:4}}>WIN RATE</div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:"#7CFFB2"}}>{winRate(myGames)}</div>
            </div>
            <div style={{flex:1,background:"#11131F",borderRadius:18,padding:"16px",border:"2px solid rgba(255,255,255,0.08)",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:4}}>GAMES</div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Oswald',sans-serif",color:"#E8ECF4"}}>{myGames.length}</div>
            </div>
          </div>
        </>
      )}
      {false&&(
        <>
          <div style={{...s.sectionLabel,marginBottom:10}}>team comparison</div>
          <div style={{background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.05)",marginBottom:20}}>
            <div style={{display:"grid",gridTemplateColumns:`70px repeat(${STAT_FIELDS.length},1fr)`,gap:4,marginBottom:8}}>
              <div/>
              {STAT_FIELDS.map(f=><div key={f} style={{fontSize:9.5,color:"#4A5066",fontWeight:700,textAlign:"center",textTransform:"uppercase",letterSpacing:0.5}}>{f}</div>)}
            </div>
            {PLAYERS.map(p=>{
              const pg=modeGames.filter(g=>g.playerId===p.id).sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,5);
              return (
                <div key={p.id} style={{display:"grid",gridTemplateColumns:`70px repeat(${STAT_FIELDS.length},1fr)`,gap:4,marginBottom:8,alignItems:"center"}}>
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
      {(()=>{
        const sorted = [...myGames].reverse();
        const byDay = [];
        const seen = {};
        sorted.forEach(g => {
          const gdk = dateKey(new Date(g.ts));
          if (!seen[gdk]) { seen[gdk] = true; byDay.push({ dk: gdk, games: [] }); }
          byDay[byDay.length-1].games.push(g);
        });
        // fix: group properly
        const dayMap = {};
        sorted.forEach(g => {
          const gdk = dateKey(new Date(g.ts));
          if (!dayMap[gdk]) dayMap[gdk] = [];
          dayMap[gdk].push(g);
        });
        const days = Object.entries(dayMap).sort((a,b) => b[0].localeCompare(a[0]));
        const visibleDays = showAllGames ? days : days.slice(0,3);
        return visibleDays.map(([dk, dayGames]) => (
          <DayGameGroup key={dk} dk={dk} games={dayGames} playerColor={playerColor} jumpDate={jumpDate} STAT_FIELDS={STAT_FIELDS} allStats={stats} currentPlayer={currentPlayer} onUpdateOpponentScore={updateOpponentScore}/>
        ));
      })()}
{Object.keys((()=>{const m={}; myGames.forEach(g=>{m[dateKey(new Date(g.ts))]=1;}); return m;})()).length > 3 && (
        <button onClick={()=>setShowAllGames(v=>!v)} className="bb-pressable"
          style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"11px 0",fontSize:12,fontWeight:700,color:"#8B92A8",cursor:"pointer",marginTop:4}}>
          {showAllGames ? `▲ show less` : `▼ show all days`}
        </button>
      )}
      </>
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
whiteout: {
    id: "whiteout",
    bg: "#F7F7F2", card: "#FFFFFF", border: "rgba(0,0,0,0.12)",
    accent: "#FF61C1", accentText: "#06070D", text: "#11131F",
    sub: "#34384A", muted: "#667085", tabBg: "#F0F0EA",
    swatch: "linear-gradient(135deg,#FFFFFF 45%,#FF61C1 45%,#B8FF4D 70%)",
  },
pinkboost: {
    id: "pinkboost",
    bg: "#120814", card: "#1C0B22", border: "rgba(255,97,193,0.22)",
    accent: "#FF61C1", accentText: "#06070D", text: "#FFE7F5",
    sub: "#B98BA8", muted: "#6E4D62", tabBg: "#180A1F",
    swatch: "linear-gradient(135deg,#FF61C1,#A78BFA,#4D9EFF)",
  },
matrix: {
    id: "matrix",
    bg: "#020806", card: "#07130C", border: "rgba(184,255,77,0.20)",
    accent: "#B8FF4D", accentText: "#020806", text: "#D9FFD0",
    sub: "#84A879", muted: "#3E5739", tabBg: "#030B08",
    swatch: "repeating-linear-gradient(90deg,#020806 0px,#020806 5px,#B8FF4D 6px,#020806 10px)",
  },
};

const FLOWER_TYPES = [
  { id: "rose",       emoji: "🌹", label: "Rose",       xp: 20, desc: "legendary play" },
  { id: "sunflower",  emoji: "🌻", label: "Sunflower",  xp: 15, desc: "great assist" },
  { id: "tulip",      emoji: "🌷", label: "Tulip",      xp: 10, desc: "nice save" },
  { id: "daisy",      emoji: "🌼", label: "Daisy",      xp: 5,  desc: "solid effort" },
];

function getDailyShopSeed() {
  const now = new Date();
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  if (now < noon) noon.setDate(noon.getDate() - 1);
  return noon.getTime();
}

function getDailyShopItems() {
  const seed = getDailyShopSeed();
  let h = seed;
  const seeded = (items, salt = 0) => [...items].map((item, i) => {
    h = ((h * 1664525 + 1013904223) + i * 7919 + salt) & 0xffffffff;
    return { item, sort: Math.abs(h) };
  }).sort((a, b) => a.sort - b.sort).map(x => x.item);
  const backgrounds = seeded(SHOP_ITEMS.filter(i => i.type === "background"), 9001).slice(0, 4);
  const others = seeded(SHOP_ITEMS.filter(i => i.type !== "background"), 1337).slice(0, 10);
  return [...others, ...backgrounds];
}

function getTimeUntilNextShop() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(12, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

const SHOP_ITEMS = [
  // colors
  { id:"lime_name",   label:"lime",     desc:"lime green name glow",   cost:50,  type:"color", value:"#B8FF4D", emoji:"🟢" },
  { id:"pink_name",   label:"pink",     desc:"hot pink name glow",     cost:50,  type:"color", value:"#FF61C1", emoji:"🩷" },
  { id:"violet_name", label:"violet",   desc:"violet name glow",       cost:50,  type:"color", value:"#A78BFA", emoji:"💜" },
  { id:"gold_name",   label:"gold",     desc:"gold name glow",         cost:75,  type:"color", value:"#FFD166", emoji:"🌟" },
  { id:"red_name",    label:"red",      desc:"hot red name glow",      cost:75,  type:"color", value:"#FF5C8A", emoji:"❤️" },
  { id:"teal_name",   label:"teal",     desc:"neon teal name glow",    cost:75,  type:"color", value:"#00FFD0", emoji:"🩵" },
  { id:"orange_name", label:"orange",   desc:"burnt orange name glow", cost:75,  type:"color", value:"#FF8C42", emoji:"🟠" },
  { id:"blue_name",   label:"blue",     desc:"electric blue name glow",cost:50,  type:"color", value:"#4D9EFF", emoji:"🔵" },
  // icons
  { id:"frog",        label:"frog",                  cost:60,  type:"icon",  value:"🐸",     emoji:"🐸" },
  { id:"icon_fire",   label:"fire",            cost:60,  type:"icon",  value:"🔥",     emoji:"🔥" },
  { id:"icon_crown",  label:"crown",         cost:100, type:"icon",  value:"👑",     emoji:"👑" },
  { id:"icon_goat",   label:"GOAT",       cost:80,  type:"icon",  value:"🐐",     emoji:"🐐" },
  { id:"icon_bolt",   label:"bolt",        cost:70,  type:"icon",  value:"⚡",     emoji:"⚡" },
  { id:"icon_alien",  label:"alien",        cost:90,  type:"icon",  value:"👾",     emoji:"👾" },
  { id:"icon_rocket", label:"rocket",                cost:65,  type:"icon",  value:"🚀",     emoji:"🚀" },
  { id:"icon_skull",  label:"nailed it",           cost:70,  type:"icon",  value:"💅",     emoji:"💀" },
  { id:"icon_diamond",label:"diamond",         cost:80,  type:"icon",  value:"💎",     emoji:"💎" },
  { id:"icon_ghost",  label:"ghost",         cost:60,  type:"icon",  value:"👻",     emoji:"👻" },
  { id:"icon_wolf",   label:"wolf",            cost:75,  type:"icon",  value:"🐺",     emoji:"🐺" },
  { id:"icon_dragon", label:"dragon",             cost:90,  type:"icon",  value:"🐉",     emoji:"🐉" },
  { id:"icon_swords", label:"swords",               cost:70,  type:"icon",  value:"⚔️",     emoji:"⚔️" },
  { id:"icon_target", label:"target",             cost:65,  type:"icon",  value:"🎯",     emoji:"🎯" },
  { id:"icon_snake",  label:"snake",        cost:70,  type:"icon",  value:"🐍",     emoji:"🐍" },
  { id:"icon_bat",    label:"bat",      cost:60,  type:"icon",  value:"🦇",     emoji:"🦇" },
  { id:"icon_tiger",  label:"tiger",                 cost:80,  type:"icon",  value:"🐯",     emoji:"🐯" },
  { id:"icon_shark",  label:"shark",          cost:85,  type:"icon",  value:"🦈",     emoji:"🦈" },
  // titles
  { id:"title_demogod",    cost:60,  type:"title", value:"demo god"            },
  { id:"title_petty",      cost:60,  type:"title", value:"petty player"        },
  { id:"title_scallions",  cost:100, type:"title", value:"scanlons scallions"  },
  { id:"title_lonely",     cost:70,  type:"title", value:"the lonely girl"     },
  { id:"title_powershot",  cost:75,  type:"title", value:"powershot pimp"      },
  { id:"title_saved",      cost:65,  type:"title", value:"saved the day"       },
  { id:"title_rule69",     cost:69,  type:"title", value:"rule 69"             },
  { id:"title_buffalo",    cost:200, type:"title", value:"buffalo burton"      },

  // daily background rotation
  { id:"bg_carbon",    label:"Carbon Fiber", emoji:"⬛", desc:"dark carbon weave texture",       cost:80,   type:"background", value:"carbon" },
  { id:"bg_spring",    label:"Soft Spring",  emoji:"🌸", desc:"gentle pastel gradient",          cost:80,   type:"background", value:"spring" },
  { id:"bg_aurora",    label:"Aurora",       emoji:"🌌", desc:"shifting northern lights",        cost:100,  type:"background", value:"aurora" },
  { id:"bg_midnight",  label:"Midnight Oil", emoji:"🌙", desc:"deep navy shimmer",               cost:100,  type:"background", value:"midnight" },
  { id:"bg_whiteout",  label:"Whiteout",     emoji:"⚪", desc:"white base with pink/lime pop",    cost:150,  type:"background", value:"whiteout" },
  { id:"bg_pinkboost", label:"Pink Boost",   emoji:"🌸", desc:"pink + purple gradient arena",    cost:150,  type:"background", value:"pinkboost" },
  { id:"bg_matrix",    label:"Matrix",       emoji:"🟩", desc:"green black code glow",           cost:175,  type:"background", value:"matrix" },
  { id:"bg_morse",     label:"Morse Code",   emoji:"📡", desc:"animated signal-style green bars",cost:175,  type:"background", value:"morse" },
  { id:"bg_turf",      label:"Grass Turf",   emoji:"🌱", desc:"field grass texture",             cost:150,  type:"background", value:"turf" },
  { id:"bg_moss",      label:"Moss Stone",   emoji:"🪨", desc:"dark moss textured background",   cost:150,  type:"background", value:"moss" },
  { id:"bg_goalnet",   label:"Goal Net",     emoji:"🥅", desc:"stadium netting overlay",         cost:150,  type:"background", value:"goalnet" },
  { id:"bg_custom",    label:"Ultimate BG",  emoji:"🖼️", desc:"upload your own image",           cost:5000, type:"background", value:"custom" },

];
const DAILY_SPINS_MAX = 3;
const DAILY_SLOTS_MAX = 3;
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
  36: { type:"color",  value:"#BBF2D9", label:"mint green" },
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
  50: { type:"title",  value:"", label:"" },
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
  9:  { type:"icon",   value:"💩", label:"poop icon" },
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
  31: { type:"coins",  value:50, label:"+50 pts" },
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
  100:{ type:"text_color", value:"app_text_colors", label:"custom app text kit" },
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
const PASS_WEEKLY_FIELDS = ["goals", "assists", "saves", "shots"];
const TIME_GOALS_BY_WEEK = [6, 7, 8, 9, 10, 11, 12, 13];

function getWeeklyPassChallenge(playerId, stats) {
  const idx = PLAYERS.findIndex(p => p.id === playerId);
  const weekNum = Math.floor(Date.now() / WEEK_MS); // hours, ramps up each week toward tournament
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
  return Date.now() - new Date(ts).getTime() < 45000;
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


function MusicShare({ currentPlayer, addToast }) {
  const [link, setLink] = useState("");
  const [shared, setShared] = useState([]);

  useEffect(() => {
    storeGet("music_links").then(v => { if (v) setShared(Array.isArray(v) ? v : []); });
    const unsub = subscribeKVMulti(["music_links"], ({ value }) => {
      setShared(Array.isArray(value) ? value : []);
    });
    return () => unsub?.();
  }, []);

  const detectPlatform = (url) => {
    if (url.includes("spotify.com")) return { label:"Spotify", emoji:"S", color:"#1DB954" };
    if (url.includes("soundcloud.com")) return { label:"SoundCloud", emoji:"SC", color:"#FF5500" };
    if (url.includes("music.apple.com")) return { label:"Apple Music", emoji:"AM", color:"#FC3C44" };
    if (url.includes("youtube.com")||url.includes("youtu.be")) return { label:"YouTube", emoji:"YT", color:"#FF0000" };
    return { label:"Link", emoji:"->", color:"#B8FF4D" };
  };

  const submit = async () => {
    if (!link.trim()) return;
    const platform = detectPlatform(link.trim());
    const entry = {
      id: Date.now().toString(),
      playerId: currentPlayer,
      playerName: PLAYERS.find(p => p.id === currentPlayer)?.name,
      playerColor: PLAYERS.find(p => p.id === currentPlayer)?.color,
      url: link.trim(),
      platform,
      ts: new Date().toISOString(),
    };
    const upd = [entry, ...shared].slice(0, 20);
    setShared(upd);
    await storeSet("music_links", upd);
    setLink("");
    addToast(`${entry.playerName} shared a ${platform.label} link`);
  };

  return (
    <div style={{marginTop:20}}>
      <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>MUSIC SHARE</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input
          value={link}
          onChange={e=>setLink(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="paste spotify, soundcloud, youtube, apple music..."
          style={{...s.chatInput,flex:1,fontSize:12}}
        />
        <button onClick={submit} className="bb-pressable bb-glow-lime" style={s.chatSendBtn}>
          <Send size={16}/>
        </button>
      </div>
      {shared.length===0 && (
        <div style={{textAlign:"center",color:"#4A5066",fontSize:13,padding:"20px 0"}}>no links shared yet</div>
      )}
      {shared.map(entry => {
        const p = entry.platform;
        return (
          <div key={entry.id} style={{background:"#11131F",borderRadius:14,padding:"12px 14px",marginBottom:10,border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:700,color:p.color}}>{p.label}</span>
              <span style={{fontSize:11,color:"#4A5066",marginLeft:"auto"}}>{fmtRelTime(entry.ts)}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
              <div style={{width:6,height:6,borderRadius:99,background:entry.playerColor,flexShrink:0}}/>
              <span style={{fontSize:11,fontWeight:700,color:entry.playerColor}}>{entry.playerName}</span>
            </div>
            <button
              onClick={()=>window.open(entry.url,"_blank")}
              style={{display:"block",width:"100%",background:"rgba(184,255,77,0.08)",border:"1px solid rgba(184,255,77,0.25)",borderRadius:10,padding:"10px 12px",fontSize:12,color:"#B8FF4D",fontWeight:700,textAlign:"center",cursor:"pointer"}}
            >
              open link
            </button>
          </div>
        );
      })}
    </div>
  );
}




function PresenceTab({ presence, setPresence, pings, setPings, currentPlayer, points, setPoints, completions, stats, passXP, setPassXP, passPremium, setPassPremium, passTokens, setPassTokens, setTab, flowers, setFlowers, addToast, activityFeed, setActivityFeed, parseCredits, creditRequests, setCreditRequests }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
const [showFlowers, setShowFlowers] = useState(false);
const [shopCountdown, setShopCountdown] = useState(getTimeUntilNextShop());
const dailyShopItems = getDailyShopItems();

useEffect(() => {
  const iv = setInterval(() => setShopCountdown(getTimeUntilNextShop()), 1000);
  return () => clearInterval(iv);
}, []);
useEffect(() => {
  setMyMode(presence?.[currentPlayer + "_mode"] || null);
}, [currentPlayer, presence]);

useEffect(() => {
  let alive = true;
  const loadVoicePresence = async () => {
    const vp = await storeGet("voice_presence") || {};
    const cutoff = Date.now() - 45 * 1000;
    const cleaned = Object.fromEntries(
      Object.entries(vp).filter(([_, v]) => new Date(v.ts).getTime() > cutoff)
    );
    if (alive) setVoicePresence(cleaned);
  };
  loadVoicePresence();
  const timer = setInterval(loadVoicePresence, 5000);
  return () => { alive = false; clearInterval(timer); };
}, []);

const [flowerTarget, setFlowerTarget] = useState(null);
const [selectedFlower, setSelectedFlower] = useState(null);
const [showPass, setShowPass] = useState(false);
const customBgFileRef = useRef(null);
const [purchaseReveal, setPurchaseReveal] = useState(null);
const [myMode, setMyMode] = useState(null);
const [voicePresence, setVoicePresence] = useState({});

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
    setPurchaseReveal({ item, opened:false });
  };

const toggleEquip = async (itemId) => {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  const newEquipped = { ...equipped };
  if (item?.type === "background") {
    // only one background can be equipped at a time
    SHOP_ITEMS.filter(i => i.type === "background").forEach(i => { delete newEquipped[i.id]; });
  } else if (item) {
    SHOP_ITEMS.filter(i => i.type === item.type).forEach(i => { delete newEquipped[i.id]; });
  } else {
    // fallback for older saved background ids
    ["bg_carbon","bg_spring","bg_aurora","bg_midnight","bg_matrix","bg_whiteout","bg_pinkboost","bg_morse","bg_turf","bg_moss","bg_goalnet","bg_custom"].forEach(id => { delete newEquipped[id]; });
  }
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
const activityNotifs = (activityFeed||[]).filter(e => e.to === currentPlayer).map(e => ({
    id: e.id, ts: e.ts,
    text: `${e.fromName} ${e.text}`,
    icon: e.type==="like" ? "❤️" : e.type==="comment" ? "💬" : e.type==="comment_heart" ? "🩷" : "🔔",
    isActivity: true,
  }));

  const pingNotifs = (pings||[]).filter(p => p.to === currentPlayer).map(p => ({
    id: p.id, ts: p.ts,
    text: p.type==="flower"
      ? `${PLAYERS.find(pl=>pl.id===p.from)?.name} sent you ${p.emoji} (+${p.xp} xp)`
      : p.type==="session"
        ? `${PLAYERS.find(pl=>pl.id===p.from)?.name} started a ${p.mode || "3v3"} session ${p.minutesUntil ? `in ${p.minutesUntil} min` : "soon"}`
        : p.type==="coinflip"
          ? `${PLAYERS.find(pl=>pl.id===p.from)?.name} challenged you to a coin flip`
          : `${PLAYERS.find(pl=>pl.id===p.from)?.name} wants to run 2s`,
    icon: p.type==="flower" ? "🌸" : p.type==="session" ? "⏱️" : p.type==="coinflip" ? "🪙" : "🎮",
  }));

  const trainingNotifs = Object.entries(completions||{})
    .filter(([k,v]) => v.status==="approved" && k.endsWith(`__${currentPlayer}`))
    .map(([k,v]) => ({ id:k, ts:v.reviewedAt||v.submittedAt, text:`training approved — +15 pts`, icon:"✅" }));

  const notifs = [...activityNotifs, ...pingNotifs, ...trainingNotifs]
    .sort((a,b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 30);
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {/* Points bar */}
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:2}}>YOUR POINTS</div>
         <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:600,color:"#B8FF4D"}}>{myPoints}</div>
        </div>
<div style={{display:"flex",gap:8,overflowX:"scroll",WebkitOverflowScrolling:"touch",paddingBottom:4,paddingTop:8,paddingRight:8,scrollbarWidth:"none",msOverflowStyle:"none"}}>
          <button onClick={()=>setShowShop(v=>!v)} className="bb-pressable" style={{background:"rgba(184,255,77,0.1)",border:"1px solid rgba(184,255,77,0.3)",borderRadius:10,padding:"8px 12px",color:"#B8FF4D",fontSize:12,fontWeight:700,cursor:"pointer"}}>🛍 shop</button>
<button onClick={()=>{ if(passPremium?.[currentPlayer]) setTab("garage"); else setShowPass(v=>!v); }} className="bb-pressable" style={{background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"8px 12px",color:"#A78BFA",fontSize:12,fontWeight:700,cursor:"pointer"}}>🎫 pass</button>
          <button onClick={()=>setShowRecap(v=>!v)} className="bb-pressable" style={{background:"rgba(255,209,102,0.1)",border:"1px solid rgba(255,209,102,0.3)",borderRadius:10,padding:"8px 12px",color:"#FFD166",fontSize:12,fontWeight:700,cursor:"pointer"}}>📊 recap</button>
<button onClick={() => setShowFlowers(v => !v)} className="bb-pressable" style={{ background: "rgba(255,97,193,0.1)", border: "1px solid rgba(255,97,193,0.3)", borderRadius: 10, padding: "8px 12px", color: "#FF61C1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🌸 props</button>
        </div>
      </div>

      {/* Parse Credits hidden: sync credits are captain-controlled now. */}
      {/* Notification center */}
   {showNotifs && (
        <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(167,139,250,0.2)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:12,color:"#A78BFA",fontWeight:700,letterSpacing:0.5}}>NOTIFICATIONS</div>
            {notifs.length>0&&<button onClick={async()=>{
              const af = await storeGet("activity_feed")||[];
              const cleared = af.filter(e=>e.to!==currentPlayer);
              await storeSet("activity_feed",cleared);
              setActivityFeed([]);
            }} className="bb-pressable" style={{background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.25)",borderRadius:8,padding:"4px 10px",fontSize:10,fontWeight:700,color:"#FF5C8A",cursor:"pointer"}}>
              clear all
            </button>}
          </div>
          {notifs.length===0 && <div style={{color:"#4A5066",fontSize:13}}>nothing yet</div>}
          {notifs.map(n=>(
            <div key={n.id} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <span style={{fontSize:16}}>{n.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:"#E8ECF4"}}>{n.text}</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{fmtRelTime(n.ts)}</div>
              </div>
              {n.isActivity&&<button onClick={async()=>{
                const af = await storeGet("activity_feed")||[];
                const upd = af.filter(e=>e.id!==n.id);
                await storeSet("activity_feed",upd);
                setActivityFeed(upd.filter(e=>e.to===currentPlayer));
              }} className="bb-pressable" style={{background:"none",border:"none",color:"#4A5066",cursor:"pointer",padding:"2px 4px",flexShrink:0}}>
                <X size={14}/>
              </button>}
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

{showFlowers && (
  <div style={{ background: "#11131F", borderRadius: 14, padding: 14, marginBottom: 16, border: "1px solid rgba(255,97,193,0.2)" }}>
    <div style={{ fontSize: 12, color: "#FF61C1", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>SEND PROPS 🌸</div>
    <div style={{ fontSize: 11, color: "#4A5066", marginBottom: 12 }}>choose a teammate and send them xp from your own stash</div>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {PLAYERS.filter(p => p.id !== currentPlayer).map(p => (
        <button key={p.id} onClick={() => setFlowerTarget(p.id)} className="bb-pressable"
          style={{ flex: 1, background: flowerTarget === p.id ? p.color : "rgba(255,255,255,0.05)", border: `1px solid ${flowerTarget === p.id ? p.color : "rgba(255,255,255,0.08)"}`, borderRadius: 10, padding: "9px 0", fontSize: 11, fontWeight: 700, color: flowerTarget === p.id ? "#06070D" : "#8B92A8", cursor: "pointer" }}>
          {p.name}
        </button>
      ))}
    </div>
    {flowerTarget && (
      <>
        <div style={{ fontSize: 11, color: "#4A5066", fontWeight: 700, marginBottom: 8 }}>PICK A FLOWER</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {FLOWER_TYPES.map(f => (
            <button key={f.id} onClick={() => setSelectedFlower(f.id)} className="bb-pressable"
              style={{ flex: 1, background: selectedFlower === f.id ? "rgba(255,97,193,0.2)" : "rgba(255,255,255,0.03)", border: `1px solid ${selectedFlower === f.id ? "#FF61C1" : "rgba(255,255,255,0.06)"}`, borderRadius: 12, padding: "10px 4px", textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontSize: 22 }}>{f.emoji}</div>
              <div style={{ fontSize: 9, color: "#E8ECF4", fontWeight: 700, marginTop: 3 }}>{f.label}</div>
              <div style={{ fontSize: 9, color: "#FF61C1", fontWeight: 700 }}>{f.xp} xp</div>
            </button>
          ))}
        </div>
        {selectedFlower && (() => {
          const flower = FLOWER_TYPES.find(f => f.id === selectedFlower);
        const myXP = passXP?.[currentPlayer] || 0;
const myPtsCheck = points?.[currentPlayer] || 0;
const canAfford = myPtsCheck >= flower.xp;
          return (
            <button onClick={async () => {
              if (!canAfford) return;
          const myPts = points?.[currentPlayer] || 0;
const updPts = {
  ...points,
  [currentPlayer]: myPts - flower.xp,
  [flowerTarget]: (points?.[flowerTarget] || 0) + flower.xp,
};
setPoints(updPts);
await storeSet("points", updPts);
              const updFlowers = [...(flowers || []), { id: Date.now().toString(), from: currentPlayer, to: flowerTarget, flower: flower.id, emoji: flower.emoji, xp: flower.xp, ts: new Date().toISOString() }];
              setFlowers(updFlowers);
              await storeSet("flowers", updFlowers);
const pingUpd2 = [...(pings||[]), {id:(Date.now()+2).toString(), from:currentPlayer, to:flowerTarget, ts:new Date().toISOString(), type:"flower", emoji:flower.emoji, xp:flower.xp}];
setPings(pingUpd2);
await storeSet("pings", pingUpd2);
              addToast?.(`${flower.emoji} sent ${flower.label} to ${PLAYERS.find(p => p.id === flowerTarget)?.name} — ${flower.xp} pts`, "🌸");
              setSelectedFlower(null); setFlowerTarget(null);
            }} disabled={!canAfford} className="bb-pressable bb-glow-lime"
              style={{ width: "100%", background: canAfford ? "#FF61C1" : "rgba(255,255,255,0.04)", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 12.5, fontWeight: 700, color: canAfford ? "#06070D" : "#4A5066", cursor: canAfford ? "pointer" : "default" }}>
              {canAfford ? `send ${flower.emoji} — costs you ${flower.xp} pts` : `not enough pts (need ${flower.xp})`}
            </button>
          );
        })()}
      </>
    )}
    {(flowers || []).filter(f => f.to === currentPlayer).length > 0 && (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, color: "#4A5066", fontWeight: 700, marginBottom: 8 }}>RECEIVED</div>
        {[...(flowers || [])].filter(f => f.to === currentPlayer).reverse().slice(0, 5).map(f => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12, color: "#8B92A8" }}>
            <span style={{ fontSize: 18 }}>{f.emoji}</span>
            <span style={{ color: "#E8ECF4", fontWeight: 700 }}>{PLAYERS.find(p => p.id === f.from)?.name}</span>
            <span>sent you a {FLOWER_TYPES.find(fl => fl.id === f.flower)?.label}</span>
            <span style={{ marginLeft: "auto", color: "#FF61C1", fontWeight: 700 }}>+{f.xp} pts</span>
          </div>
        ))}
      </div>
    )}
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
  setShowPass(false);
  setTab("garage");
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
  <div style={{ fontSize: 12, color: "#B8FF4D", fontWeight: 700, letterSpacing: 0.5 }}>DAILY SHOP</div>
  <div style={{ fontSize: 10, color: "#4A5066", fontWeight: 700 }}>
    🕐 resets in {String(Math.floor(shopCountdown / 3600000)).padStart(2,"0")}:{String(Math.floor((shopCountdown % 3600000) / 60000)).padStart(2,"0")}:{String(Math.floor((shopCountdown % 60000) / 1000)).padStart(2,"0")}
  </div>
</div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:12}}>earn pts by logging games (+10) and getting training approved (+15). weekly stat leaders get +50 jackpot.</div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:8}}>NAME COLORS</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
              {dailyShopItems.filter(i=>i.type==="color").map(item=>{
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
              {dailyShopItems.filter(i=>i.type==="icon").map(item=>{
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
              {dailyShopItems.filter(i=>i.type==="title").map(item=>{
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
<div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:8,marginTop:16}}>BACKGROUNDS</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {dailyShopItems.filter(i=>i.type==="background").map(item => {
                const isOwned = owned.includes(item.id);
                const isEquipped = equipped[item.id];
                const canAfford = myPoints >= item.cost;
                const isCustom = item.value === "custom";
                return (
                  <div key={item.id} style={{background:isEquipped?"rgba(167,139,250,0.08)":"rgba(255,255,255,0.03)",borderRadius:13,padding:"12px 14px",border:`1px solid ${isEquipped?"rgba(167,139,250,0.3)":isOwned?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)"}`,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:36,height:36,borderRadius:8,flexShrink:0,background:
                      item.value==="carbon"?"repeating-linear-gradient(45deg,#1a1a1a 0px,#1a1a1a 2px,#2a2a2a 2px,#2a2a2a 4px)":
                      item.value==="spring"?"linear-gradient(135deg,#ffd6e7,#c3f0ca,#a8d8ea)":
                      item.value==="aurora"?"linear-gradient(135deg,#0d0221,#00ff87,#60efff)":
                      item.value==="midnight"?"linear-gradient(135deg,#0a0a2e,#1a1a5e,#2d2d8f)":
                      item.value==="whiteout"?"linear-gradient(135deg,#FFFFFF,#F7F7F2,#FF61C1)":
                      item.value==="pinkboost"?"linear-gradient(135deg,#FF61C1,#A78BFA,#4D9EFF)":
                      item.value==="matrix"?"repeating-linear-gradient(90deg,#020806 0 5px,#B8FF4D 5px 6px,#020806 6px 12px)":
                      item.value==="morse"?"repeating-linear-gradient(90deg,#B8FF4D 0 8px,#020806 8px 14px,#B8FF4D 14px 17px,#020806 17px 28px)":
                      item.value==="turf"?"repeating-linear-gradient(115deg,#15360F 0 3px,#1F4B17 3px 6px,#10280C 6px 9px)":
                      item.value==="moss"?"radial-gradient(circle,#315D25,#081307)":
                      item.value==="goalnet"?"linear-gradient(90deg,rgba(255,255,255,.55) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.55) 1px,transparent 1px),#101625":
                      "linear-gradient(135deg,#A78BFA,#FFD166)"
                    }}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:isOwned?"#A78BFA":"#E8ECF4"}}>{item.label}</div>
                      <div style={{fontSize:10,color:"#4A5066",marginTop:1}}>{item.desc}{item.cost===5000?" · 5000 pts":""}</div>
                    </div>
                    {isOwned ? (
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {isCustom && isEquipped && (
                          <>
                            <input ref={customBgFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
                              const f=e.target.files?.[0]; if(!f)return;
                              const url=URL.createObjectURL(f);
                              const upd={...points,[currentPlayer+"_customBg"]:url};
                              setPoints(upd); await storeSet("points",upd);
                            }}/>
                            <button onClick={()=>customBgFileRef.current?.click()} className="bb-pressable"
                              style={{background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:8,padding:"5px 10px",fontSize:10,fontWeight:700,color:"#A78BFA",cursor:"pointer"}}>
                              upload
                            </button>
                          </>
                        )}
                        <button onClick={()=>toggleEquip(item.id)} className="bb-pressable"
                          style={{background:isEquipped?"#A78BFA":"rgba(255,255,255,0.06)",border:"none",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,color:isEquipped?"#06070D":"#8B92A8",cursor:"pointer"}}>
                          {isEquipped?"✓ on":"equip"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>buyItem(item)} disabled={!canAfford} className="bb-pressable"
                        style={{background:canAfford?"rgba(167,139,250,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?"rgba(167,139,250,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,color:canAfford?"#A78BFA":"#4A5066",cursor:canAfford?"pointer":"default"}}>
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
      {purchaseReveal && (
        <div style={{position:"fixed",inset:0,zIndex:900,background:"rgba(4,8,24,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"chatFadeIn .18s ease"}}>
          <div style={{width:"100%",maxWidth:320,textAlign:"center",background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(255,209,102,0.35)",borderRadius:24,padding:22,boxShadow:"0 24px 70px rgba(0,0,0,0.45)",animation:"dropDown .32s cubic-bezier(.2,.8,.2,1)"}}>
            {!purchaseReveal.opened ? (
              <button onClick={()=>setPurchaseReveal(r=>({...r,opened:true}))} className="bb-pressable" style={{background:"none",border:"none",cursor:"pointer",width:"100%"}}>
                <div style={{fontSize:68,filter:"drop-shadow(0 14px 24px rgba(255,209,102,0.22))"}}>🎁</div>
                <div style={{fontSize:11,color:"#FFD166",fontWeight:900,letterSpacing:1,marginTop:8}}>TAP TO OPEN</div>
              </button>
            ) : (
              <div>
                <div style={{fontSize:54,animation:"scaleFadeIn .2s ease"}}>{purchaseReveal.item.emoji || "✨"}</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,color:"#E8ECF4",marginTop:8}}>{purchaseReveal.item.label}</div>
                <div style={{fontSize:12,color:"#8B92A8",marginTop:4}}>{purchaseReveal.item.desc || "added to your collection"}</div>
                <button onClick={()=>setPurchaseReveal(null)} className="bb-pressable bb-glow-lime" style={{...s.primaryBtn,marginTop:18}}>claim</button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Online now */}


<div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
  {["1v1","2v2","3v3","free play",null].map(m=>(
    <button key={m??"off"} onClick={async()=>{
      setMyMode(m);
      const upd={...presence,[currentPlayer+"_mode"]:m,[currentPlayer]:new Date().toISOString()};
      setPresence(upd); await storeSet("presence",upd);
    }} className="bb-pressable"
    style={{background:myMode===m?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,color:myMode===m?"#06070D":"#8B92A8",cursor:"pointer"}}>
      {m??"off"}
    </button>
  ))}
</div>

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
        <div style={{fontSize:11,color:"#4A5066",marginTop:1}}>
          {voicePresence?.[p.id] ? "in voice room" : online ? (presence?.[p.id+"_mode"] ? `🎮 in ${presence[p.id+"_mode"]}` : "online now") : presence?.[p.id] ? `last seen ${fmtRelTime(presence[p.id])}` : "offline"}
        </div>
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
{myPings.filter(p => p.type !== "flower").length > 0 && (
  <>
    <div style={{...s.sectionLabel,marginBottom:10}}>squad pings</div>
    {myPings.filter(p => p.type !== "flower").map(p=>{
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
function getPassRewardForOwnedId(ownedId) {   // ← NEW LOCATION
  const parts = ownedId.split("_");
  const t = parts[1];
  const tier = Number(parts[2]);
  const rewards = t === "free" ? FREE_PASS_REWARDS : PREMIUM_PASS_REWARDS;
  return rewards[tier] || null;
}
// ===================== Pass Tab =====================
function GarageTab({ currentPlayer, points, setPoints, passXP, passPremium, passTokens, setPassTokens, passClaimed, setPassClaimed, passActiveBoosts }) {
  const [track, setTrack] = useState("free");
  const [claimResult, setClaimResult] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const garageTopRef = useRef(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const [trackSwipeOffset, setTrackSwipeOffset] = useState(0);
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

  const switchTrack = (nextTrack) => {
    if (nextTrack === "premium" && !isPremium) return;
    setTrack(nextTrack);
    setTiersExpanded(false);
    setTrackSwipeOffset(0);
    setTimeout(() => garageTopRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 0);
  };

  const handleTrackTouchStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  };

  const handleTrackTouchMove = (e) => {
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - swipeStartY.current);
    if (Math.abs(dx) > dy && Math.abs(dx) > 12) setTrackSwipeOffset(Math.max(-70, Math.min(70, dx)));
  };

  const handleTrackTouchEnd = () => {
    if (trackSwipeOffset < -55 && track === "free" && isPremium) switchTrack("premium");
    else if (trackSwipeOffset > 55 && track === "premium") switchTrack("free");
    else setTrackSwipeOffset(0);
  };

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

    if (reward.type === "color" || reward.type === "icon" || reward.type === "title" || reward.type === "text_color") {
      const owned = points?.[currentPlayer + "_owned"] || [];
      const itemId = `pass_${t}_${tier}`;
      if (!owned.includes(itemId)) {
        const upd = { ...points, [currentPlayer + "_owned"]: [...owned, itemId] };
        setPoints(upd);
        await storeSet("points", upd);
      }
    }

    setClaimResult({ tier, reward, opened:false });
  };

const rewardTiers = Object.entries(currentRewards).map(([tier, reward]) => ({ tier: Number(tier), reward })).sort((a, b) => a.tier - b.tier);
const [tiersExpanded, setTiersExpanded] = useState(false);
const visibleTiers = tiersExpanded ? rewardTiers : rewardTiers.slice(0, 5);
  const myTokens = passTokens?.[currentPlayer] || [];

  return (
    <div ref={garageTopRef} className="bb-tab-content" style={s.tabContent} onTouchStart={handleTrackTouchStart} onTouchMove={handleTrackTouchMove} onTouchEnd={handleTrackTouchEnd}>
      {claimResult && (
        <div style={{position:"fixed",inset:0,zIndex:900,background:"rgba(4,8,24,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"chatFadeIn .18s ease"}}>
          <div style={{width:"100%",maxWidth:320,textAlign:"center",background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(167,139,250,0.35)",borderRadius:24,padding:22,boxShadow:"0 24px 70px rgba(0,0,0,0.45)",animation:"dropDown .32s cubic-bezier(.2,.8,.2,1)"}}>
            {!claimResult.opened ? (
              <button onClick={()=>setClaimResult(r=>({...r,opened:true}))} className="bb-pressable" style={{background:"none",border:"none",cursor:"pointer",width:"100%"}}>
                <div style={{fontSize:68,filter:"drop-shadow(0 14px 24px rgba(167,139,250,0.25))"}}>🎁</div>
                <div style={{fontSize:11,color:"#A78BFA",fontWeight:900,letterSpacing:1,marginTop:8}}>TAP TO OPEN</div>
              </button>
            ) : (
              <div>
                <div style={{fontSize:54,animation:"scaleFadeIn .2s ease"}}>{claimResult.reward.type === "coins" ? "🪙" : claimResult.reward.type === "icon" ? claimResult.reward.value : claimResult.reward.type === "color" || claimResult.reward.type === "text_color" ? "🎨" : claimResult.reward.type === "title" ? "📝" : "✨"}</div>
                <div style={{fontSize:11,color:"#A78BFA",fontWeight:900,letterSpacing:1,marginTop:6}}>TIER {claimResult.tier} UNLOCKED</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,color:"#E8ECF4",marginTop:8}}>{claimResult.reward.label || claimResult.reward.value}</div>
                <div style={{fontSize:12,color:"#8B92A8",marginTop:4}}>added to your pass rewards</div>
                <button onClick={()=>setClaimResult(null)} className="bb-pressable bb-glow-lime" style={{...s.primaryBtn,marginTop:18}}>claim</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* XP summary */}
      <div style={{ background: "linear-gradient(135deg,#11131F,#0C0E18)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 16, padding: "16px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#A78BFA", fontWeight: 700, letterSpacing: 0.8, marginBottom: 8 }}>BURTON PASS · SEASON 1</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 26, fontWeight: 600, color: playerColor }}>{myXP}<span style={{ fontSize: 12, color: "#4A5066", marginLeft: 4 }}>xp</span></div>
            <div style={{ fontSize: 11, color: "#4A5066", marginTop: 2 }}>+20 per training approval · +2 per game logged</div>
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
        <button onClick={() => switchTrack("free")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", background: track === "free" ? "#B8FF4D" : "rgba(255,255,255,0.05)", color: track === "free" ? "#06070D" : "#8B92A8" }}>
          free track
        </button>
        <button onClick={() => switchTrack("premium")} className="bb-pressable"
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: isPremium ? "pointer" : "default", background: track === "premium" ? "#A78BFA" : "rgba(255,255,255,0.05)", color: track === "premium" ? "#06070D" : isPremium ? "#A78BFA" : "#4A5066", opacity: isPremium ? 1 : 0.5 }}>
          {isPremium ? "premium track" : "🔒 premium"}
        </button>
      </div>

      {/* Tier reward list */}
      <div style={{ ...s.sectionLabel, marginBottom: 12 }}>tier rewards</div>
      <div style={{ transform:`translateX(${trackSwipeOffset}px)`, transition:trackSwipeOffset===0?"transform .22s ease":"none" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibleTiers.map(({ tier, reward }) => {
          const unlocked = currentProgress.tier >= tier;
          const claimed = isClaimed(track, tier);
          const isNext = !unlocked && currentProgress.tier === tier - 1;

          let rewardLabel = reward.label || reward.value;
          let rewardEmoji = reward.type === "coins" ? "🪙" : reward.type === "token" ? "🎟" : (reward.type === "color" || reward.type === "text_color") ? "🎨" : reward.type === "icon" ? reward.value : reward.type === "title" ? "📝" : reward.type === "car" ? "🏎️" : "🎁";

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
      </div>

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
const RT_KEYS = ["chat", "posts", "completions", "training", "schedule", "comments", "stream_profiles", "stats", "presence", "pings", "points", "bets", "pass_xp", "pass_premium", "pass_claimed", "pass_tokens", "pass_active_boosts", "time_logs", "stocks", "coin_flips", "active_race", "flowers","flip_challenges", "chemistry", "team_room", "team_sessions", "typing", "activity_feed", "parse_credits", "music_links", "room_music", "credit_requests"];
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
  return Math.round(wager * Math.min(parseFloat(decimalOdds), 5));
}

function StockTrendLine({ priceHistory, color, width = 260, height = 70 }) {
  if (!priceHistory || priceHistory.length < 2) {
    return (
      <div style={{height, display:"flex", alignItems:"center", justifyContent:"center", color:"#4A5066", fontSize:11}}>
        not enough games yet for a chart
      </div>
    );
  }
  const vals = priceHistory.slice(-20);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = Math.max(1, max - min);
  const pad = 6;
  const w = width, h = height;

  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return { x, y };
  });

  const linePoints = pts.map(p => `${p.x},${p.y}`).join(" ");
  const areaPoints = `${pts[0].x},${h} ${linePoints} ${pts[pts.length-1].x},${h}`;

  const up = vals[vals.length - 1] >= vals[0];
  const lineColor = color || (up ? "#7CFFB2" : "#FF5C8A");
  const gradId = `stockgrad-${lineColor.replace("#","")}`;

  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline points={linePoints} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        i === pts.length - 1
          ? <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={lineColor} style={{filter:`drop-shadow(0 0 4px ${lineColor}99)`}}/>
          : null
      ))}
    </svg>
  );
}

function StockMarketTab({ stats, currentPlayer, points, setPoints, stocks, setStocks }) {
  const myPoints = points?.[currentPlayer] || 0;
  const [investAmount, setInvestAmount] = useState(10);
  const [result, setResult] = useState(null);

  const getStockPrice = (playerId) => {
    const pg = stats.filter(g => g.playerId === playerId && g.mode === "3v3");
    if (!pg.length) return STOCK_BASE_PRICE;
    const weekStart = getWeekStart();
    const weekGames = pg.filter(g => new Date(g.ts) >= weekStart);
    const allAvgGoals = pg.length ? pg.reduce((s,g) => s+(g.goals||0),0)/pg.length : 1;
    const weekAvgGoals = weekGames.length ? weekGames.reduce((s,g) => s+(g.goals||0),0)/weekGames.length : allAvgGoals;
    const wins = pg.filter(g => g.result === "victory").length;
    const winRate = pg.length ? wins/pg.length : 0.5;
    const weekWins = weekGames.filter(g => g.ourScore > g.theirScore).length;
    const weekWinRate = weekGames.length ? weekWins/weekGames.length : winRate;
    const price = Math.round(STOCK_BASE_PRICE * (1 + (weekWinRate - 0.5) * 1.5 + (weekAvgGoals - allAvgGoals) * 0.2));
    return Math.max(10, Math.min(500, price));
  };

const getStockPriceHistory = (playerId) => {
    const pg = stats
      .filter(g => g.playerId === playerId && g.mode === "3v3")
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (pg.length < 2) return null; // not enough points for a real chart

    const allAvgGoalsRunning = [];
    const history = pg.map((g, i) => {
      const upToHere = pg.slice(0, i + 1);
      const weekStart = getWeekStart();
      const weekGames = upToHere.filter(gg => new Date(gg.ts) >= weekStart);
      const allAvgGoals = upToHere.reduce((s, gg) => s + (gg.goals || 0), 0) / upToHere.length;
      const weekAvgGoals = weekGames.length
        ? weekGames.reduce((s, gg) => s + (gg.goals || 0), 0) / weekGames.length
        : allAvgGoals;
      const wins = upToHere.filter(gg => gg.ourScore > gg.theirScore).length;
      const winRate = wins / upToHere.length;
      const weekWins = weekGames.filter(gg => gg.ourScore > gg.theirScore).length;
      const weekWinRate = weekGames.length ? weekWins / weekGames.length : winRate;
      const price = Math.round(STOCK_BASE_PRICE * (1 + (weekWinRate - 0.5) * 1.5 + (weekAvgGoals - allAvgGoals) * 0.2));
      return Math.max(10, Math.min(500, price));
    });
    return history;
  };
  const getPriceChange = (playerId) => {
    const current = getStockPrice(playerId);
    const prev = stocks?.[playerId+"_prevPrice"] || STOCK_BASE_PRICE;
    return { change: current - prev, pct: (((current - prev) / prev) * 100).toFixed(1) };
  };

  const invest = async (targetId) => {
    if (myPoints < investAmount) return;
    const price = getStockPrice(targetId);
    const shares = investAmount / price;
    const existing = stocks?.[currentPlayer+"_"+targetId] || { shares: 0, invested: 0 };
    const upd = {
      ...stocks,
      [currentPlayer+"_"+targetId]: { shares: existing.shares + shares, invested: existing.invested + investAmount },
      [targetId+"_prevPrice"]: price,
    };
    setStocks(upd); await storeSet("stocks", upd);
    const updPts = { ...points, [currentPlayer]: myPoints - investAmount };
    setPoints(updPts); await storeSet("points", updPts);
    setResult({ action: "bought", amount: investAmount, player: PLAYERS.find(p=>p.id===targetId)?.name });
    setTimeout(() => setResult(null), 3000);
  };

  const cashOut = async (targetId) => {
    const holding = stocks?.[currentPlayer+"_"+targetId];
    if (!holding || holding.shares <= 0) return;
    const currentPrice = getStockPrice(targetId);
    const value = Math.round(holding.shares * currentPrice);
    const profit = value - holding.invested;
    const upd = { ...stocks, [currentPlayer+"_"+targetId]: { shares: 0, invested: 0 }, [targetId+"_prevPrice"]: currentPrice };
    setStocks(upd); await storeSet("stocks", upd);
    const updPts = { ...points, [currentPlayer]: myPoints + value };
    setPoints(updPts); await storeSet("points", updPts);
    setResult({ action: "sold", value, profit, player: PLAYERS.find(p=>p.id===targetId)?.name });
    setTimeout(() => setResult(null), 3000);
  };

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>invest points into teammates before matches. if they pop off this week their stock rises and you profit. if they choke you lose.</div>

      {result && (
        <div style={{background:result.profit>=0||result.action==="bought"?"rgba(124,255,178,0.08)":"rgba(255,92,138,0.08)",border:`1px solid ${result.profit>=0||result.action==="bought"?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.3)"}`,borderRadius:14,padding:14,marginBottom:16,textAlign:"center"}}>
          {result.action==="bought" ? (
            <div style={{fontSize:13,fontWeight:700,color:"#7CFFB2"}}>invested {result.amount} pts in {result.player} 📈</div>
          ) : (
            <>
              <div style={{fontSize:13,fontWeight:700,color:result.profit>=0?"#7CFFB2":"#FF5C8A"}}>cashed out {result.player} for {result.value} pts</div>
              <div style={{fontSize:12,color:"#8B92A8",marginTop:4}}>{result.profit>=0?"+":""}{result.profit} pts profit</div>
            </>
          )}
        </div>
      )}

      <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(255,255,255,0.05)"}}>
        <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:10}}>INVEST AMOUNT</div>
        <div style={{display:"flex",gap:8}}>
          {[10,25,50,100].map(amt=>(
            <button key={amt} onClick={()=>setInvestAmount(amt)} className="bb-pressable"
              style={{flex:1,background:investAmount===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"8px 0",fontSize:11,fontWeight:700,color:investAmount===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
              {amt}
            </button>
          ))}
        </div>
      </div>

      {PLAYERS.filter(p => p.id !== currentPlayer).map(player => {
        const price = getStockPrice(player.id);
        const { change, pct } = getPriceChange(player.id);
        const holding = stocks?.[currentPlayer+"_"+player.id];
        const hasShares = holding?.shares > 0;
        const currentValue = hasShares ? Math.round(holding.shares * price) : 0;
        const profit = hasShares ? currentValue - holding.invested : 0;
        const pg = stats.filter(g => g.playerId === player.id && g.mode === "3v3");
        const weekStart = getWeekStart();
        const weekGames = pg.filter(g => new Date(g.ts) >= weekStart);

        return (
          <div key={player.id} style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"16px",marginBottom:14,border:`1px solid ${player.color}22`}}>
           <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:10,height:10,borderRadius:99,background:player.color,boxShadow:`0 0 8px ${player.color}99`}}/>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:player.color}}>{player.name}</span>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#E8ECF4"}}>{price}<span style={{fontSize:11,color:"#4A5066",marginLeft:2}}>pts</span></div>
                <div style={{fontSize:11,fontWeight:700,color:change>=0?"#7CFFB2":"#FF5C8A"}}>{change>=0?"▲":"▼"} {Math.abs(change)} ({pct}%)</div>
              </div>
            </div>

            <div style={{marginBottom:12, background:"rgba(255,255,255,0.02)", borderRadius:10, padding:"8px 4px"}}>
              <StockTrendLine priceHistory={getStockPriceHistory(player.id)} color={change>=0?"#7CFFB2":"#FF5C8A"} width={280} height={70}/>
            </div>

            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <div style={{flex:1,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#4A5066",fontWeight:700,marginBottom:2}}>THIS WEEK</div>
                <div style={{fontSize:13,fontWeight:700,color:player.color}}>{weekGames.length}g</div>
              </div>
              <div style={{flex:1,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#4A5066",fontWeight:700,marginBottom:2}}>WIN RATE</div>
                <div style={{fontSize:13,fontWeight:700,color:"#E8ECF4"}}>{weekGames.length?Math.round(weekGames.filter(g=>g.ourScore>g.theirScore).length/weekGames.length*100):0}%</div>
              </div>
              <div style={{flex:1,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#4A5066",fontWeight:700,marginBottom:2}}>AVG GOALS</div>
                <div style={{fontSize:13,fontWeight:700,color:"#E8ECF4"}}>{weekGames.length?(weekGames.reduce((s,g)=>s+(g.goals||0),0)/weekGames.length).toFixed(1):0}</div>
              </div>
            </div>

            {hasShares && (
              <div style={{background:profit>=0?"rgba(124,255,178,0.06)":"rgba(255,92,138,0.06)",border:`1px solid ${profit>=0?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`,borderRadius:10,padding:"10px 12px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:10,color:"#4A5066",marginBottom:2}}>YOUR POSITION</div>
                    <div style={{fontSize:13,fontWeight:700,color:"#E8ECF4"}}>{holding.shares.toFixed(3)} shares · invested {holding.invested} pts</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color:profit>=0?"#7CFFB2":"#FF5C8A"}}>{currentValue} pts</div>
                    <div style={{fontSize:11,color:profit>=0?"#7CFFB2":"#FF5C8A"}}>{profit>=0?"+":""}{profit} profit</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>invest(player.id)} disabled={myPoints<investAmount} className="bb-pressable bb-glow-lime"
                style={{flex:1,background:myPoints>=investAmount?"rgba(184,255,77,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${myPoints>=investAmount?"rgba(184,255,77,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,color:myPoints>=investAmount?"#B8FF4D":"#4A5066",cursor:myPoints>=investAmount?"pointer":"default"}}>
                📈 buy {investAmount} pts
              </button>
              {hasShares && (
                <button onClick={()=>cashOut(player.id)} className="bb-pressable"
                  style={{flex:1,background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,color:"#FF5C8A",cursor:"pointer"}}>
                  💰 cash out {currentValue} pts
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

          
// ===================== RLCS Trivia =====================
const RLCS_QUESTIONS = [
  { q:"Which team won the RLCS 2022 World Championship?", options:["Team BDS","Moist Esports","G2 Esports","NRG"], answer:0 },
  { q:"Which team won RLCS Worlds 2023?", options:["Team Vitality","Karmine Corp","Team BDS","Gen.G Mobil1 Racing"], answer:0 },
  { q:"Which team won RLCS Worlds 2024?", options:["G2 Stride","Team BDS","Gentle Mates Alpine","Team Falcons"], answer:1 },
  { q:"Who is known as 'The Machine'?", options:["Turbopolsa","Kaydop","GarrettG","M0nkey M00n"], answer:0 },
  { q:"Which player is commonly associated with the famous zero-second goal for NRG?", options:["jstn","Squishy","GarrettG","Chicago"], answer:0 },
  { q:"Which country does Fairy Peak! come from?", options:["Germany","France","Sweden","Netherlands"], answer:1 },
  { q:"What is the max boost amount in Rocket League?", options:["50","75","100","150"], answer:2 },
  { q:"What year did Rocket League go free to play?", options:["2018","2019","2020","2021"], answer:2 },
  { q:"How many players are on each team in standard Rocket League?", options:["1","2","3","4"], answer:2 },
  { q:"What does RLCS stand for?", options:["Rocket League Championship Series","Rocket League Cup Series","Ranked League Championship System","Rocket League Champions Split"], answer:0 },
  { q:"What is the duration of a standard Rocket League match?", options:["3 minutes","4 minutes","5 minutes","6 minutes"], answer:2 },
  { q:"What rank is directly above Diamond?", options:["Platinum","Champion","Grand Champion","Supersonic Legend"], answer:1 },
  { q:"What is an aerial?", options:["A ground shot","Flying through the air to hit the ball","A wall-only save","A kickoff type"], answer:1 },
  { q:"What is a musty flick named after?", options:["A player/content creator named Musty","A weather condition","An RLCS coach","A map"], answer:0 },
  { q:"What does rotation mean in Rocket League strategy?", options:["Spinning your car","Players cycling positions and turns","Changing camera settings","Boosting in circles"], answer:1 },
  { q:"Which mechanic uses a second jump after leaving the wall or ground?", options:["Flip reset","Half flip","Wave dash","Ceiling pinch"], answer:0 },
  { q:"What does a small boost pad give?", options:["6 boost","12 boost","18 boost","25 boost"], answer:1 },
  { q:"What does a large boost pad give?", options:["50 boost","75 boost","100 boost","125 boost"], answer:2 },
  { q:"What is a demo?", options:["Destroying another car by supersonic contact","Saving a shot","Passing midfield","Faking kickoff"], answer:0 },
  { q:"What is a kickoff?", options:["Start/restart play from center","A postgame replay","A boost grab route","A goal explosion"], answer:0 },
  { q:"Which mode is 2 players vs 2 players?", options:["Duel","Doubles","Standard","Chaos"], answer:1 },
  { q:"Which mode is 1 player vs 1 player?", options:["Duel","Doubles","Standard","Dropshot"], answer:0 },
  { q:"Which mode is 3 players vs 3 players?", options:["Hoops","Duel","Standard","Snow Day"], answer:2 },
  { q:"What does 'OT' mean on the scoreboard?", options:["Overtime","Out Time","Open Touch","Off Target"], answer:0 },
  { q:"What does 'GG' usually mean after a match?", options:["Good game","Great goal","Get going","Goal gap"], answer:0 },
  { q:"Which stat tracks passes that lead to a teammate goal?", options:["Saves","Assists","Shots","Demos"], answer:1 },
  { q:"Which stat tracks shots stopped near your goal?", options:["Goals","Assists","Saves","Demos"], answer:2 },
  { q:"What is a shutout?", options:["Winning with opponent scoring zero","Scoring from midfield","Losing in overtime","Missing every shot"], answer:0 },
  { q:"What does '50/50' mean?", options:["A challenge where both players contest the ball","A 50 boost pickup","A half-field shot","A tied series"], answer:0 },
  { q:"What is a fake kickoff?", options:["Pretending to challenge kickoff but leaving it","A broken replay","A random demo","A kickoff goal"], answer:0 },
  { q:"What is a ceiling shot?", options:["A shot after driving/falling from the ceiling","A shot that hits the floor","A save off the post","A kickoff shot"], answer:0 },
  { q:"What is a pinch?", options:["Ball squeezed between surfaces/cars for speed","A slow dribble","A boost steal","A demo chain"], answer:0 },
  { q:"Which button action is needed to dodge/flip?", options:["Jump twice with a direction","Only boost","Only powerslide","Only air roll"], answer:0 },
  { q:"What does powerslide help with?", options:["Sharper ground turns/recoveries","More boost capacity","Longer jumps","Bigger demos"], answer:0 },
  { q:"What is back-post rotation?", options:["Rotating to the far post on defense","Driving into opponent net","Only staying midfield","Chasing the ball"], answer:0 },
  { q:"What is ball cam?", options:["Camera locks focus on the ball","A replay export","A training pack","A goal explosion"], answer:0 },
  { q:"What is car cam?", options:["Camera follows your car direction","Camera locks the ball","A spectator view","A tournament mode"], answer:0 },
  { q:"What does MMR affect?", options:["Matchmaking rank/rating","Car color only","Boost amount","Arena size"], answer:0 },
  { q:"What is SSL short for?", options:["Supersonic Legend","Super Speed League","Season Score Level","Standard Solo League"], answer:0 },
  { q:"What comes after Grand Champion in rank?", options:["Champion","Supersonic Legend","Diamond","Platinum"], answer:1 },
];

function RLCSTrivia({ currentPlayer, points, setPoints }) {
  const [started, setStarted] = useState(false);
  const [wager, setWager] = useState(10);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [done, setDone] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [streak, setStreak] = useState(0);

  const myPoints = points?.[currentPlayer] || 0;

  const startGame = () => {
    if (myPoints < wager) return;
    const shuffled = [...RLCS_QUESTIONS]
      .map(q => ({ q, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map(x => x.q)
      .slice(0, 5);
    setQuestions(shuffled);
    setQIndex(0); setSelected(null); setCorrect(0); setWrong(0);
    setDone(false); setStreak(0); setStarted(true);
  };

  const pick = async (idx) => {
    if (selected !== null) return;
    setSelected(idx);
    const q = questions[qIndex];
    const isCorrect = idx === q.answer;
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    if (isCorrect) setCorrect(c => c + 1); else setWrong(w => w + 1);
    setTimeout(async () => {
      if (qIndex + 1 >= questions.length) {
        // settle
        const totalCorrect = correct + (isCorrect ? 1 : 0);
        const mult = totalCorrect === 5 ? 3 : totalCorrect === 4 ? 2 : totalCorrect === 3 ? 1.5 : totalCorrect === 2 ? 1 : 0;
        const payout = Math.round(wager * mult);
        const net = payout - wager;
        const upd = { ...points, [currentPlayer]: Math.max(0, myPoints - wager + payout) };
        setPoints(upd); await storeSet("points", upd);
        setDone(true);
      } else {
        setQIndex(i => i + 1);
        setSelected(null);
      }
    }, 900);
  };

  const reset = () => { setStarted(false); setDone(false); setSelected(null); setQIndex(0); setCorrect(0); setWrong(0); };

  if (!started) return (
    <div>
      <div style={{ background:"linear-gradient(135deg,#11131F,#0C0E18)", border:"1px solid rgba(77,158,255,0.2)", borderRadius:18, padding:"24px 20px", textAlign:"center", marginBottom:16 }}>
        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:20, fontWeight:700, color:"#4D9EFF", marginBottom:4 }}>RLCS TRIVIA</div>
        <div style={{ fontSize:12, color:"#4A5066", marginBottom:20, lineHeight:1.5 }}>5 questions · 5/5 = 3x · 4/5 = 2x · 3/5 = 1.5x · 2/5 = 1x · 1/5 or less = 0</div>
        <div style={{ fontSize:11, color:"#4A5066", fontWeight:700, marginBottom:8 }}>WAGER</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
          {[5,10,25,50,100].map(amt => (
            <button key={amt} onClick={() => setWager(amt)} className="bb-pressable"
              style={{ background:wager===amt?"#4D9EFF":"rgba(255,255,255,0.05)", border:"none", borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:700, color:wager===amt?"#06070D":"#8B92A8", cursor:"pointer" }}>
              {amt}
            </button>
          ))}
        </div>
        <button onClick={startGame} disabled={myPoints < wager} className="bb-pressable"
          style={{ background:myPoints>=wager?"#4D9EFF":"rgba(255,255,255,0.05)", border:"none", borderRadius:12, padding:"14px 48px", fontSize:14, fontWeight:700, color:myPoints>=wager?"#06070D":"#4A5066", cursor:myPoints>=wager?"pointer":"default" }}>
          start — {wager} pts
        </button>
      </div>
    </div>
  );

  if (done) {
    const totalCorrect = correct;
    const mult = totalCorrect===5?3:totalCorrect===4?2:totalCorrect===3?1.5:totalCorrect===2?1:0;
    const payout = Math.round(wager * mult);
    const net = payout - wager;
    return (
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:12 }}>{totalCorrect >= 3 ? "🎉" : "💀"}</div>
        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:26, fontWeight:700, color:net>=0?"#7CFFB2":"#FF5C8A", marginBottom:8 }}>{correct}/5 correct</div>
        <div style={{ fontSize:14, color:"#8B92A8", marginBottom:4 }}>{mult}x multiplier · {net>=0?"+":""}{net} pts</div>
        <div style={{ fontSize:12, color:"#4A5066", marginBottom:24 }}>wagered {wager} · got back {payout}</div>
        <button onClick={reset} className="bb-pressable bb-glow-lime"
          style={{ background:"#4D9EFF", border:"none", borderRadius:12, padding:"14px 40px", fontSize:14, fontWeight:700, color:"#06070D", cursor:"pointer" }}>
          play again
        </button>
      </div>
    );
  }

  const q = questions[qIndex];
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:11, color:"#4D9EFF", fontWeight:700 }}>Q {qIndex+1} OF 5</div>
        <div style={{ display:"flex", gap:8 }}>
          <span style={{ fontSize:11, color:"#7CFFB2", fontWeight:700 }}>✓ {correct}</span>
          <span style={{ fontSize:11, color:"#FF5C8A", fontWeight:700 }}>✗ {wrong}</span>
        </div>
      </div>
      <div style={{ height:4, background:"rgba(255,255,255,0.08)", borderRadius:99, marginBottom:20, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${((qIndex)/5)*100}%`, background:"#4D9EFF", borderRadius:99, transition:"width .4s ease" }}/>
      </div>
      <div style={{ background:"#11131F", borderRadius:16, padding:"18px 16px", marginBottom:16, border:"1px solid rgba(77,158,255,0.15)" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"#E8ECF4", lineHeight:1.5 }}>{q.q}</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {q.options.map((opt, i) => {
          const isSelected = selected === i;
          const isCorrectAns = i === q.answer;
          const revealed = selected !== null;
          let bg = "rgba(255,255,255,0.04)";
          let border = "rgba(255,255,255,0.08)";
          let color = "#E8ECF4";
          if (revealed && isCorrectAns) { bg="rgba(124,255,178,0.12)"; border="#7CFFB2"; color="#7CFFB2"; }
          else if (revealed && isSelected && !isCorrectAns) { bg="rgba(255,92,138,0.12)"; border="#FF5C8A"; color="#FF5C8A"; }
          return (
            <button key={i} onClick={() => pick(i)} disabled={selected!==null} className="bb-pressable"
              style={{ background:bg, border:`1px solid ${border}`, borderRadius:12, padding:"14px 16px", fontSize:13.5, fontWeight:600, color, cursor:selected===null?"pointer":"default", textAlign:"left", transition:"all .2s" }}>
              <span style={{ color:"#4A5066", marginRight:10 }}>{["A","B","C","D"][i]}.</span>{opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
          
          // ===================== Boost Grab =====================
const BOOST_PADS = [
  { color:"#B8FF4D", label:"Small",  mult:1.5,  prob:0.14, emoji:"🟢" },
  { color:"#4D9EFF", label:"Medium", mult:2.0,  prob:0.11, emoji:"🔵" },
  { color:"#A78BFA", label:"Big",    mult:3.0,  prob:0.08, emoji:"🟣" },
  { color:"#FFD166", label:"Full",   mult:4.0,  prob:0.05, emoji:"🟡" },
  { color:"#FF8C42", label:"Mega",   mult:6.0,  prob:0.02, emoji:"🟠" },
  { color:"#7CFFB2", label:"Super",  mult:8.0,  prob:0.01, emoji:"🩵" },
  { color:"#FF5C8A", label:"BOMB",   mult:0,    prob:0.20, isDead:true, emoji:"🔴" },
  { color:"#FF5C8A", label:"BOMB",   mult:0,    prob:0.18, isDead:true, emoji:"🔴" },
  { color:"#FF5C8A", label:"BOMB",   mult:0,    prob:0.13, isDead:true, emoji:"🔴" },
  { color:"#FF5C8A", label:"BOMB",   mult:0,    prob:0.08, isDead:true, emoji:"🔴" },
];
function generateGrid() {
  return Array.from({ length: 12 }, (_, i) => {
    const r = Math.random();
    let cum = 0;
    for (const pad of BOOST_PADS) {
      cum += pad.prob;
      if (r <= cum) return { ...pad, id: i, revealed: false };
    }
    return { ...BOOST_PADS[0], id: i, revealed: false };
  });
}

function BoostGrab({ currentPlayer, points, setPoints }) {
  const [wager, setWager] = useState(10);
  const [grid, setGrid] = useState(null);
  const [collected, setCollected] = useState([]);
  const [dead, setDead] = useState(false);
  const [cashed, setCashed] = useState(false);
  const [totalMult, setTotalMult] = useState(1);

  const myPoints = points?.[currentPlayer] || 0;

  const startGame = () => {
    if (myPoints < wager) return;
    setGrid(generateGrid());
    setCollected([]); setDead(false); setCashed(false); setTotalMult(1);
  };

  const tap = async (pad) => {
    if (!grid || pad.revealed || dead || cashed) return;
    const newGrid = grid.map(p => p.id === pad.id ? { ...p, revealed: true } : p);
    setGrid(newGrid);
    if (pad.isDead) {
      setDead(true);
      const upd = { ...points, [currentPlayer]: Math.max(0, myPoints - wager) };
      setPoints(upd); await storeSet("points", upd);
    } else {
      const newMult = totalMult * pad.mult;
      setTotalMult(newMult);
      setCollected(c => [...c, pad]);
    }
  };

  const cashOut = async () => {
    if (!grid || dead || cashed || collected.length === 0) return;
    setCashed(true);
    const payout = Math.round(wager * totalMult);
    const upd = { ...points, [currentPlayer]: Math.max(0, myPoints - wager + payout) };
    setPoints(upd); await storeSet("points", upd);
  };

  const reset = () => { setGrid(null); setCollected([]); setDead(false); setCashed(false); setTotalMult(1); };

  if (!grid) return (
    <div>
    
      <div style={{ background:"linear-gradient(135deg,#0A1808,#06070D)", border:"1px solid rgba(184,255,77,0.2)", borderRadius:18, padding:"24px 20px", textAlign:"center", marginBottom:16 }}>
        
        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:20, fontWeight:700, color:"#B8FF4D", marginBottom:4 }}>BOOST GRAB</div>
        <div style={{ fontSize:12, color:"#4A5066", marginBottom:20 }}>hit 🔴 = lose wager · cash out anytime</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginBottom:16 }}>
          {BOOST_PADS.filter(p => !p.isDead).map(p => (
            <div key={p.label} style={{ fontSize:10, color:p.color, fontWeight:700, background:`${p.color}18`, padding:"4px 8px", borderRadius:99 }}>
              {p.emoji} {p.mult}x
            </div>
          ))}
          <div style={{ fontSize:10, color:"#FF5C8A", fontWeight:700, background:"rgba(255,92,138,0.1)", padding:"4px 8px", borderRadius:99 }}>🔴 BOMB</div>
        </div>
        <div style={{ fontSize:11, color:"#4A5066", fontWeight:700, marginBottom:8 }}>WAGER</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
          {[5,10,25,50].map(amt => (
            <button key={amt} onClick={() => setWager(amt)} className="bb-pressable"
              style={{ background:wager===amt?"#B8FF4D":"rgba(255,255,255,0.05)", border:"none", borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:700, color:wager===amt?"#06070D":"#8B92A8", cursor:"pointer" }}>
              {amt}
            </button>
          ))}
        </div>
        <button onClick={startGame} disabled={myPoints < wager} className="bb-pressable bb-glow-lime"
          style={{ background:myPoints>=wager?"#B8FF4D":"rgba(255,255,255,0.05)", border:"none", borderRadius:12, padding:"14px 48px", fontSize:14, fontWeight:700, color:myPoints>=wager?"#06070D":"#4A5066", cursor:myPoints>=wager?"pointer":"default" }}>
          start — {wager} pts
        </button>
      </div>
    </div>
  );

  const payout = Math.round(wager * totalMult);

  return (
    <div>
      {/* Status bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:10, color:"#4A5066", fontWeight:700 }}>CURRENT MULT</div>
          <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:22, fontWeight:700, color:"#B8FF4D" }}>{totalMult.toFixed(2)}x</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:10, color:"#4A5066", fontWeight:700 }}>TO WIN</div>
          <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:22, fontWeight:700, color:"#7CFFB2" }}>{payout} pts</div>
        </div>
        <button onClick={cashOut} disabled={collected.length===0||dead||cashed} className="bb-pressable"
          style={{ background:collected.length>0&&!dead&&!cashed?"#7CFFB2":"rgba(255,255,255,0.05)", border:"none", borderRadius:12, padding:"12px 18px", fontSize:13, fontWeight:700, color:collected.length>0&&!dead&&!cashed?"#06070D":"#4A5066", cursor:collected.length>0&&!dead&&!cashed?"pointer":"default" }}>
          cash out
        </button>
      </div>

      {/* Result banner */}
      {(dead || cashed) && (
        <div style={{ background:cashed?"rgba(124,255,178,0.08)":"rgba(255,92,138,0.08)", border:`1px solid ${cashed?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.3)"}`, borderRadius:14, padding:16, marginBottom:16, textAlign:"center", animation:"scaleFadeIn .3s ease" }}>
          <div style={{ fontSize:28, marginBottom:6 }}>{cashed ? "💰" : "💥"}</div>
          <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:22, fontWeight:700, color:cashed?"#7CFFB2":"#FF5C8A" }}>
            {cashed ? `+${payout - wager} pts profit` : `-${wager} pts — hit a bomb`}
          </div>
          <button onClick={reset} className="bb-pressable bb-glow-lime" style={{ background:"#B8FF4D", border:"none", borderRadius:10, padding:"12px 32px", fontSize:13, fontWeight:700, color:"#06070D", cursor:"pointer", marginTop:12 }}>
            play again
          </button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10 }}>
        {grid.map(pad => (
          <button key={pad.id} onClick={() => tap(pad)} disabled={pad.revealed || dead || cashed} className="bb-pressable"
            style={{ aspectRatio:"1", borderRadius:14, border:`2px solid ${pad.revealed ? pad.color : "rgba(255,255,255,0.1)"}`, background:pad.revealed ? `${pad.color}22` : "#11131F", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:pad.revealed||dead||cashed?"default":"pointer", transition:"all .2s", fontSize:pad.revealed?22:28 }}>
            {pad.revealed ? (
              <>
                <span>{pad.emoji}</span>
                <span style={{ fontSize:10, color:pad.color, fontWeight:700, marginTop:2 }}>{pad.isDead?"BOMB":`${pad.mult}x`}</span>
              </>
            ) : (
              <span style={{ filter:"blur(1px)", opacity:0.3 }}>⚡</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ fontSize:11, color:"#4A5066", textAlign:"center", marginTop:12 }}>
        {collected.length} boosts collected · {dead?"game over":cashed?"cashed out":"keep going or cash out"}
      </div>
    </div>
  );
}
          
          
// ===================== Weekly Recap Trivia =====================
function WeeklyRecapTrivia({ stats, currentPlayer, points, setPoints }) {
  const [wager, setWager] = useState(10);
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);

  const myPoints = points?.[currentPlayer] || 0;
  const weekStart = getWeekStart();

  const buildQuestions = () => {
    const qs = [];
    PLAYERS.forEach(p => {
      const pg = stats.filter(g => g.playerId === p.id && g.mode === "3v3" && new Date(g.ts) >= weekStart);
      if (!pg.length) return;
      const avgGoals = (pg.reduce((s,g)=>s+(g.goals||0),0)/pg.length).toFixed(1);
      const avgSaves = (pg.reduce((s,g)=>s+(g.saves||0),0)/pg.length).toFixed(1);
      const wins = pg.filter(g=>g.ourScore>g.theirScore).length;
      const winPct = Math.round(wins/pg.length*100);

      const wrongGoals = [
        (parseFloat(avgGoals)+0.8).toFixed(1),
        (parseFloat(avgGoals)-0.7).toFixed(1),
        (parseFloat(avgGoals)+1.5).toFixed(1),
      ].map(v => Math.max(0,parseFloat(v)).toFixed(1));

      qs.push({
        q:`what was ${p.name}'s avg goals/game in 3v3 this week?`,
        options:[avgGoals,...wrongGoals].sort(()=>Math.random()-0.5),
        answer:0,
        _correct: avgGoals,
      });

      const wrongWin = [
        Math.min(100,winPct+15),
        Math.max(0,winPct-20),
        Math.min(100,winPct+30),
      ];
      qs.push({
        q:`what was ${p.name}'s win rate this week?`,
        options:[`${winPct}%`,...wrongWin.map(w=>`${w}%`)].sort(()=>Math.random()-0.5),
        answer:0,
        _correct:`${winPct}%`,
      });
    });

    // fix answers after shuffle
    return qs.filter(q => q.options.length === 4).map(q => ({
      ...q,
      answer: q.options.indexOf(q._correct),
    })).sort(() => Math.random()-0.5).slice(0,5);
  };

  const start = () => {
    const qs = buildQuestions();
    if (qs.length < 3) return;
    setQuestions(qs); setQIndex(0); setSelected(null);
    setCorrect(0); setDone(false); setStarted(true);
  };

  const pick = async (idx) => {
    if (selected !== null) return;
    setSelected(idx);
    const isCorrect = idx === questions[qIndex].answer;
    const newCorrect = correct + (isCorrect ? 1 : 0);
    if (isCorrect) setCorrect(newCorrect);
    setTimeout(async () => {
      if (qIndex + 1 >= questions.length) {
        const mult = newCorrect === questions.length ? 3 : newCorrect >= questions.length-1 ? 2 : newCorrect >= Math.floor(questions.length/2) ? 1.5 : 0;
        const payout = Math.round(wager * mult);
        const upd = { ...points, [currentPlayer]: Math.max(0, myPoints - wager + payout) };
        setPoints(upd); await storeSet("points", upd);
        setDone(true);
      } else {
        setQIndex(i => i+1); setSelected(null);
      }
    }, 900);
  };

  const reset = () => { setStarted(false); setDone(false); setSelected(null); setQIndex(0); setCorrect(0); };

  const weekGames = stats.filter(g => new Date(g.ts) >= weekStart);
  if (weekGames.length < 3) return (
    <div style={{ textAlign:"center", padding:"24px 0" }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
      <div style={{ fontSize:13, color:"#4A5066" }}>not enough games logged this week — play some 3v3 first to unlock recap trivia.</div>
    </div>
  );

  if (!started) return (
    <div>
      <div style={{ background:"linear-gradient(135deg,#11131F,#0C0E18)", border:"1px solid rgba(255,209,102,0.2)", borderRadius:18, padding:"24px 20px", textAlign:"center", marginBottom:16 }}>
        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:20, fontWeight:700, color:"#FFD166", marginBottom:4 }}>WEEKLY RECAP TRIVIA</div>
        <div style={{ fontSize:12, color:"#4A5066", marginBottom:20 }}>questions based on THIS week's real stats</div>
        <div style={{ fontSize:11, color:"#4A5066", fontWeight:700, marginBottom:8 }}>WAGER</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
          {[5,10,25,50].map(amt => (
            <button key={amt} onClick={() => setWager(amt)} className="bb-pressable"
              style={{ background:wager===amt?"#FFD166":"rgba(255,255,255,0.05)", border:"none", borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:700, color:wager===amt?"#06070D":"#8B92A8", cursor:"pointer" }}>
              {amt}
            </button>
          ))}
        </div>
        <button onClick={start} disabled={myPoints<wager} className="bb-pressable"
          style={{ background:myPoints>=wager?"#FFD166":"rgba(255,255,255,0.05)", border:"none", borderRadius:12, padding:"14px 48px", fontSize:14, fontWeight:700, color:myPoints>=wager?"#06070D":"#4A5066", cursor:myPoints>=wager?"pointer":"default" }}>
          start — {wager} pts
        </button>
      </div>
    </div>
  );

  if (done) {
    const mult = correct===questions.length?3:correct>=questions.length-1?2:correct>=Math.floor(questions.length/2)?1.5:0;
    const payout = Math.round(wager*mult);
    return (
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:12 }}>{correct>=3?"🎉":"💀"}</div>
        <div style={{ fontFamily:"'Oswald',sans-serif", fontSize:26, fontWeight:700, color:payout>=wager?"#7CFFB2":"#FF5C8A", marginBottom:8 }}>{correct}/{questions.length} correct</div>
        <div style={{ fontSize:14, color:"#8B92A8", marginBottom:24 }}>{mult}x · {payout>=wager?"+":""}{payout-wager} pts</div>
        <button onClick={reset} className="bb-pressable"
          style={{ background:"#FFD166", border:"none", borderRadius:12, padding:"14px 40px", fontSize:14, fontWeight:700, color:"#06070D", cursor:"pointer" }}>
          play again
        </button>
      </div>
    );
  }

  const q = questions[qIndex];
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ fontSize:11, color:"#FFD166", fontWeight:700 }}>Q {qIndex+1} OF {questions.length}</div>
        <div style={{ fontSize:11, color:"#7CFFB2", fontWeight:700 }}>✓ {correct}</div>
      </div>
      <div style={{ height:4, background:"rgba(255,255,255,0.08)", borderRadius:99, marginBottom:20, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${(qIndex/questions.length)*100}%`, background:"#FFD166", borderRadius:99, transition:"width .4s" }}/>
      </div>
      <div style={{ background:"#11131F", borderRadius:16, padding:"18px 16px", marginBottom:16, border:"1px solid rgba(255,209,102,0.15)" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"#E8ECF4", lineHeight:1.5 }}>{q.q}</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {q.options.map((opt, i) => {
          const revealed = selected !== null;
          const isCorrectAns = i === q.answer;
          const isSelected = selected === i;
          let bg = "rgba(255,255,255,0.04)", border = "rgba(255,255,255,0.08)", color = "#E8ECF4";
          if (revealed && isCorrectAns) { bg="rgba(124,255,178,0.12)"; border="#7CFFB2"; color="#7CFFB2"; }
          else if (revealed && isSelected) { bg="rgba(255,92,138,0.12)"; border="#FF5C8A"; color="#FF5C8A"; }
          return (
            <button key={i} onClick={() => pick(i)} disabled={selected!==null} className="bb-pressable"
              style={{ background:bg, border:`1px solid ${border}`, borderRadius:12, padding:"14px 16px", fontSize:13.5, fontWeight:600, color, cursor:selected===null?"pointer":"default", textAlign:"left", transition:"all .2s" }}>
              <span style={{ color:"#4A5066", marginRight:10 }}>{["A","B","C","D"][i]}.</span>{opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}          
          
          
function BoostTab({ stats, currentPlayer, points, setPoints, bets, setBets }) {
const [section, setSection] = useState("wheel");
const [parlayLegs, setParlayLegs] = useState([]);
const [parlayWager, setParlayWager] = useState(10);
const [showParlay, setShowParlay] = useState(false);
const [slotSpinning, setSlotSpinning] = useState(false);
const [slotReels, setSlotReels] = useState(["🚀","🚀","🚀"]);
const [slotResult, setSlotResult] = useState(null);
const [slotWager, setSlotWager] = useState(10);
const [slotDisplayReels, setSlotDisplayReels] = useState(["🚀","🚀","🚀"]);
const todayKey = dateKey(todayAtMidnight());
const spinCountKey = `spins_${currentPlayer}_${todayKey}`;
const slotCountKey = `slots_${currentPlayer}_${todayKey}`;
const spinsUsed = points?.[spinCountKey] || 0;
const slotsUsed = points?.[slotCountKey] || 0;
const spinsLeft = Math.max(0, DAILY_SPINS_MAX + (points?.[currentPlayer+"_bonusSpins"] || 0) - spinsUsed);
const slotsLeft = Math.max(0, DAILY_SLOTS_MAX + (points?.[currentPlayer+"_bonusSlots"] || 0) - slotsUsed);
  const [wager, setWager] = useState(10);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState(null);
  const [rotation, setRotation] = useState(0);
const [propWager, setPropWager] = useState(10);
const [selectedProp, setSelectedProp] = useState(null);
const [propSide, setPropSide] = useState(null);
  const [lineIndexByProp, setLineIndexByProp] = useState({}); // { [propId]: index into lineOptions }
const [predWager, setPredWager] = useState(10);
const [selectedPred, setSelectedPred] = useState(null);
const [predSide, setPredSide] = useState(null);

  const myPoints = points?.[currentPlayer] || 0;
  const playerColor = PLAYERS.find(p => p.id === currentPlayer)?.color || "#B8FF4D";

  // Build player props from stats
const PROP_FIELD_CONFIG = {
    goals:   { lines: [0.5, 1.5, 2.5, 3.5] },
    assists: { lines: [0.5, 1.5, 2.5] },
    saves:   { lines: [0.5, 1.5, 2.5, 3.5] },
    shots:   { lines: [0.5, 1.5, 2.5, 3.5, 4.5] },
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

const getLegPropKey = (leg) => leg.propKey || `${leg.playerId}_${leg.field}_${leg.line}`;
const toggleParlayLeg = (leg) => {
  setParlayLegs(prev => {
    const sameLegSelected = prev.some(l => l.id === leg.id);
    if (sameLegSelected) return prev.filter(l => l.id !== leg.id);

    // only one side from the same prop can be active at once
    const withoutSameProp = prev.filter(l => getLegPropKey(l) !== getLegPropKey(leg));
    if (withoutSameProp.length >= 4) return withoutSameProp;
    return [...withoutSameProp, leg];
  });
};
const isParlayLegSelected = (legId) => parlayLegs.some(l => l.id === legId);

const pushActivity = async ({ to, type, fromName, text, message = "", gameId = "" }) => {
  const existing = await storeGet("activity_feed") || [];

  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    to,
    type,
    fromName,
    text,
    message,
    gameId,
    ts: new Date().toISOString(),
    seen: false
  };

  await storeSet("activity_feed", [entry, ...existing].slice(0, 80));
};             
  const myOpenBets = (bets || []).filter(b => b.bettorId === currentPlayer && b.status === "open");
  const mySettledBets = (bets || []).filter(b => b.bettorId === currentPlayer && b.status !== "open");
  const cancelOpenBet = async (betId) => {
    const updBets = (bets || []).filter(b => b.id !== betId);
    setBets(updBets);
    await storeSet("bets", updBets);
  };
  const cancelAllOpenBets = async () => {
    const updBets = (bets || []).filter(b => !(b.bettorId === currentPlayer && b.status === "open"));
    setBets(updBets);
    await storeSet("bets", updBets);
  };

const spinWheel = async () => {
    if (spinning || wager < 1 || myPoints < wager) return;
    if(spinsLeft<=0) return;
    setSpinning(true);
    setSpinResult(null);
    const segAngle = 360 / WHEEL_SEGMENTS.length;
    const spins = 5 + Math.floor(Math.random() * 3);
    const targetDeg = spins * 360 + Math.random() * 360;
    const newRotation = rotation + targetDeg;
    setRotation(newRotation);
    setTimeout(async () => {
      const normalizedAngle = ((360 - (newRotation % 360)) + 360) % 360;
      const segIdx = Math.floor(normalizedAngle / segAngle) % WHEEL_SEGMENTS.length;
      const seg = WHEEL_SEGMENTS[segIdx];
      const payout = Math.round(wager * seg.mult);
      const net = payout - wager;
      const newPts = Math.max(0, myPoints - wager + payout);
      const upd = { ...points, [currentPlayer]: newPts };
      setPoints(upd);
      await storeSet("points", upd);
      const updCount = {...points,[currentPlayer]:newPts,[spinCountKey]:spinsUsed+1};
      setPoints(updCount); await storeSet("points",updCount);
      setSpinResult({ seg, wager, payout, net });
      setSpinning(false);
    }, 3000);
  };

const placeBet = async (chosenLine) => {
  if (!selectedProp || !propSide || propWager < 1 || myPoints < propWager) return;

  const card = props.find(p => p.id === selectedProp);
  if (!card) return;

  const lineIdx = lineIndexByProp[selectedProp] ?? Math.floor(card.lineOptions.length / 2);
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
    targetMode: "next_3v3",
    targetText: "next logged 3v3 game"
  };

  // close the sticky wager tray immediately after tapping place bet
  setSelectedProp(null);
  setPropSide(null);
  setPropWager(10);

  const newPts = myPoints - propWager;
  const upd = { ...points, [currentPlayer]: newPts };
  setPoints(upd);
  await storeSet("points", upd);

  const updBets = [...(bets || []), bet];
  setBets(updBets);
  await storeSet("bets", updBets);

  await pushActivity({
    to: card.playerId,
    type: "prop",
    fromName: PLAYERS.find(p => p.id === currentPlayer)?.name || "someone",
    text: `sent you props: ${propSide.toUpperCase()} ${line} ${card.field}`,
    targetMode: "next_3v3",
    targetText: "next logged 3v3 game"
  });

};

  const segAngle = 360 / WHEEL_SEGMENTS.length;

const noBettingWeek = isEventActive("no_betting");

  if (noBettingWeek) {
    return (
      <div className="bb-tab-content" style={s.tabContent}>
        <div style={{background:"linear-gradient(135deg,#1A0A14,#0C0A18)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:18,padding:"28px 20px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>🚫</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#FF5C8A",marginBottom:8}}>no betting this week</div>
          <div style={{fontSize:13,color:"#8B92A8",lineHeight:1.5}}>the wheel, slots, props, and parlays are paused — this week's modifier is no betting. check back next week.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {/* Header */}
     <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(184,255,77,0.15)",borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:2}}>YOUR BALANCE</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:600,color:"#B8FF4D"}}>{myPoints}<span style={{fontSize:12,color:"#4A5066",marginLeft:4}}>pts</span></div>
        <div style={{display:"flex",gap:12,marginTop:6}}>
          <div style={{fontSize:11,color:"#4A5066"}}><span style={{color:spinsLeft>0?"#B8FF4D":"#FF5C8A",fontWeight:700}}>{spinsLeft}</span> spins left</div>
          <div style={{fontSize:11,color:"#4A5066"}}><span style={{color:slotsLeft>0?"#A78BFA":"#FF5C8A",fontWeight:700}}>{slotsLeft}</span> slots left</div>
        </div>
        </div>
        <div style={{fontSize:11,color:"#4A5066",textAlign:"right"}}>
          <div style={{color:"#FFD166",fontWeight:700,fontSize:13}}>{myOpenBets.length} open bets</div>
          <div style={{marginTop:2}}>{mySettledBets.length} settled</div>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:8,marginBottom:18}}>
     {[{id:"wheel",label:"wheel"},{id:"slots",label:"slots"},{id:"props",label:"props"},{id:"parlay",label:"parlay"},{id:"predict",label:"predict"},{id:"mybets",label:"my bets"}].map(sec=>(
          <button key={sec.id} onClick={()=>setSection(sec.id)} className="bb-pressable"
            style={{flex:1,border:"none",borderRadius:10,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer",background:section===sec.id?"#B8FF4D":"rgba(255,255,255,0.05)",color:section===sec.id?"#06070D":"#8B92A8"}}>
            {sec.label}
          </button>
        ))}
      </div>

      {/* WHEEL */}
      {section==="wheel"&&(
        <div>

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
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:seg.color,flexShrink:0}}/>
                  <div style={{fontSize:13,color:seg.color,fontWeight:700}}>{seg.label}</div>
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:seg.color}}>{seg.mult}x</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PROPS */}
   {/* PROPS */}
      {section==="props"&&(
        <div>
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
                  setLineIndexByProp(p => ({ ...p,
  [card.id]: idx,
}));
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
                                                                                 
                    <div style={{flex:1,fontSize:11,color:"#8B92A8",lineHeight:1.35}}>
                      applies to {card?.playerName}'s next logged 3v3 game
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

     {/* SLOTS */}
      {section==="slots"&&(()=>{
        const SLOT_SYMBOLS = [
          {sym:"🥅", label:"Goal",      mult:0, prob:0.30},
          {sym:"🧤", label:"Save",      mult:1.5, prob:0.25},
          {sym:"🚀", label:"Rocket",    mult:2.0, prob:0.20},
          {sym:"💥", label:"Demo",      mult:0, prob:0.12},
          {sym:"⭐", label:"Epic Save", mult:5.0, prob:0.08},
          {sym:"👑", label:"MVP",       mult:10.0, prob:0.05},
        ];
        const pickSym = () => {
          const r = Math.random(); let cum = 0;
          for (const s of SLOT_SYMBOLS) { cum+=s.prob; if(r<=cum) return s; }
          return SLOT_SYMBOLS[0];
        };
        const spinSlots = async () => {
          if(slotSpinning||myPoints<slotWager||slotsLeft<=0) return;
          setSlotSpinning(true); setSlotResult(null);
          const results = [pickSym(),pickSym(),pickSym()];
          let tick = 0;
          const iv = setInterval(()=>{
            setSlotDisplayReels([
              SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)].sym,
              SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)].sym,
              SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)].sym,
            ]);
            tick++;
            if(tick>18){
              clearInterval(iv);
              setSlotDisplayReels(results.map(r=>r.sym));
              setSlotReels(results.map(r=>r.sym));
              const allSame = results.every(r=>r.sym===results[0].sym);
              const twosame = results[0].sym===results[1].sym||results[1].sym===results[2].sym||results[0].sym===results[2].sym;
              let mult = 0;
              if(allSame) mult = results[0].mult * 3;
              else if(twosame) mult = results.find((r,i)=>results.indexOf(r)!==i||results.lastIndexOf(r)!==i)?.mult || 0;
              const payout = Math.round(slotWager * mult);
              const net = payout - slotWager;
              const newPts = Math.max(0, myPoints - slotWager + payout);
              const upd = {...points,[currentPlayer]:newPts};
              setPoints(upd); storeSet("points",upd);
              const updCount2 = {...upd,[slotCountKey]:slotsUsed+1};
              setPoints(updCount2); storeSet("points",updCount2);
              setSlotResult({results,mult,payout,net,allSame,twosame});
              setSlotSpinning(false);
            }
          },100);
        };
        return (
          <div>
            <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>match 3 for a big win. match 2 for a small win. no match — you lose your wager.</div>
            <div style={{background:"linear-gradient(135deg,#1A0A2E,#0A0818)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:18,padding:"24px 16px",marginBottom:16,textAlign:"center"}}>
              <div style={{fontSize:11,color:"#A78BFA",fontWeight:700,letterSpacing:1,marginBottom:16}}>SLOTS</div>
              <div style={{display:"flex",justifyContent:"center",gap:12,marginBottom:20}}>
                {slotDisplayReels.map((sym,i)=>(
                  <div key={i} style={{width:80,height:80,background:"rgba(255,255,255,0.06)",borderRadius:16,border:"2px solid rgba(167,139,250,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,transition:slotSpinning?"none":"all .2s"}}>
                    {sym}
                  </div>
                ))}
              </div>
              {slotResult&&(
                <div style={{background:slotResult.net>=0?"rgba(124,255,178,0.08)":"rgba(255,92,138,0.08)",border:`1px solid ${slotResult.net>=0?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.3)"}`,borderRadius:12,padding:"12px",marginBottom:16}}>
                  <div style={{fontSize:18,marginBottom:4}}>{slotResult.allSame?"🎉 JACKPOT!":slotResult.twosame?"✨ MATCH!":"💀 NO MATCH"}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,fontWeight:700,color:slotResult.net>=0?"#7CFFB2":"#FF5C8A"}}>{slotResult.net>=0?"+":""}{slotResult.net} pts</div>
                  <div style={{fontSize:11,color:"#4A5066",marginTop:4}}>{slotResult.mult}x · wagered {slotWager} · got {slotResult.payout}</div>
                </div>
              )}
              <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:14}}>
                {[5,10,25,50].map(amt=>(
                  <button key={amt} onClick={()=>setSlotWager(amt)} className="bb-pressable"
                    style={{background:slotWager===amt?"#A78BFA":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"7px 14px",fontSize:11,fontWeight:700,color:slotWager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
                    {amt}
                  </button>
                ))}
              </div>
              <button onClick={spinSlots} disabled={slotSpinning||myPoints<slotWager} className="bb-pressable"
                style={{width:"100%",background:slotSpinning||myPoints<slotWager?"rgba(255,255,255,0.05)":"#A78BFA",border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,color:slotSpinning||myPoints<slotWager?"#4A5066":"#06070D",cursor:slotSpinning||myPoints<slotWager?"default":"pointer",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>
                {slotSpinning?"spinning…":"spin — "+slotWager+" pts"}
              </button>
            </div>
            <div style={{background:"#11131F",borderRadius:14,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:10}}>PAYOUT TABLE</div>
              {SLOT_SYMBOLS.map(s=>(
                <div key={s.sym} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:8,borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:20}}>{s.sym}</span>
                    <span style={{fontSize:12,color:"#8B92A8"}}>{s.label}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#A78BFA"}}>3x = {s.mult*3}x</div>
                    <div style={{fontSize:10,color:"#4A5066"}}>2x = {s.mult}x</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    
    {/* PARLAY */}
      {section==="parlay"&&(
        <div>
          <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>build a parlay from your open props or teammate bets. all legs must hit to win.</div>
          <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:16,border:"1px solid rgba(255,209,102,0.25)"}}>
            <div style={{fontSize:12,color:"#FFD166",fontWeight:700,letterSpacing:0.5,marginBottom:8}}>PARLAY BUILDER</div>
            {parlayLegs.length===0?(
              <div style={{fontSize:12,color:"#4A5066",marginBottom:10}}>tap + on any prop or bet below to add a leg. up to 4 legs.</div>
            ):(
              <>
                {parlayLegs.map((leg,i)=>(
                  <div key={leg.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"8px 10px"}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"#E8ECF4"}}>{leg.playerName} {leg.side} {leg.line} {leg.field}</div>
                      <div style={{fontSize:10,color:"#4A5066"}}>{leg.odds}</div>
                    </div>
                    <button onClick={()=>setParlayLegs(prev=>prev.filter((_,idx)=>idx!==i))} className="bb-pressable"
                      style={{background:"none",border:"none",color:"#FF5C8A",cursor:"pointer"}}><X size={14}/></button>
                  </div>
                ))}
                {(()=>{
                 const mult = parlayLegs.reduce((m,leg)=>{
  const dec = parseFloat(leg.odds?.replace("+","") || "100");
  const od = Math.min(leg.odds?.startsWith("+")?(dec/100)+1:(100/Math.abs(dec))+1, 3);
  return m*od;
},1);
                  const payout = Math.round(parlayWager*mult);
                  return (
                    <>
                      <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center"}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,color:"#4A5066",marginBottom:4}}>MULTIPLIER</div>
                          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#FFD166"}}>{mult.toFixed(2)}x</div>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,color:"#4A5066",marginBottom:4}}>WAGER</div>
                          <input type="number" value={parlayWager} onChange={e=>setParlayWager(Math.max(1,Number(e.target.value)))}
                            style={{...s.modalInput,padding:"8px 10px",fontSize:14}}/>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,color:"#4A5066",marginBottom:4}}>TO WIN</div>
                          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#7CFFB2"}}>{payout}</div>
                        </div>
                      </div>
                      <button onClick={async()=>{
                        if(parlayLegs.length<2||myPoints<parlayWager) return;
                        const parlayBet={id:Date.now().toString(),bettorId:currentPlayer,isParlay:true,legs:parlayLegs.map(l=>({propKey:l.propKey,playerId:l.playerId,playerName:l.playerName,field:l.field,line:l.line,side:l.side,odds:l.odds})),wager:parlayWager,payout,multiplier:mult.toFixed(2),status:"open",placedAt:new Date().toISOString()};
                        const upd={...points,[currentPlayer]:myPoints-parlayWager};
                        setPoints(upd); await storeSet("points",upd);
                        const updBets=[...(bets||[]),parlayBet];
                        setBets(updBets); await storeSet("bets",updBets);
                        setParlayLegs([]); setParlayWager(10);
                      }} disabled={parlayLegs.length<2||myPoints<parlayWager} className="bb-pressable bb-glow-lime"
                        style={{...s.primaryBtn,marginTop:12,opacity:parlayLegs.length<2||myPoints<parlayWager?0.4:1}}>
                        place {parlayLegs.length}-leg parlay — {parlayWager} pts to win {payout}
                      </button>
                    </>
                  );
                })()}
              </>
            )}
          </div>

          <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:0.5,marginBottom:10}}>AVAILABLE PROPS</div>
          {props.map(card=>{
            const lineIdx = Math.floor(card.lineOptions.length/2);
            const current = card.lineOptions[lineIdx];
            const overLeg = {id:`${card.id}_over`,propKey:card.id,playerId:card.playerId,playerName:card.playerName,field:card.field,line:current.line,side:"over",odds:current.overOdds.american};
            const underLeg = {id:`${card.id}_under`,propKey:card.id,playerId:card.playerId,playerName:card.playerName,field:card.field,line:current.line,side:"under",odds:current.underOdds.american};
            return (
              <div key={card.id} style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:8,height:8,borderRadius:99,background:card.playerColor}}/>
                  <span style={{fontWeight:700,fontSize:13,color:card.playerColor}}>{card.playerName}</span>
                  <span style={{fontSize:13,color:"#E8ECF4",marginLeft:4}}>· {card.field}</span>
                  <span style={{fontSize:11,color:"#4A5066",marginLeft:"auto"}}>line: {current.line}</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>toggleParlayLeg(overLeg)} className="bb-pressable"
                    style={{flex:1,background:isParlayLegSelected(overLeg.id)?"#7CFFB2":"rgba(124,255,178,0.08)",border:`1px solid ${isParlayLegSelected(overLeg.id)?"#7CFFB2":"rgba(124,255,178,0.2)"}`,borderRadius:10,padding:"10px 0",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#4A5066",fontWeight:700}}>OVER {current.line}</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:isParlayLegSelected(overLeg.id)?"#06070D":"#7CFFB2"}}>{current.overOdds.american}</div>
                  </button>
                  <button onClick={()=>toggleParlayLeg(underLeg)} className="bb-pressable"
                    style={{flex:1,background:isParlayLegSelected(underLeg.id)?"#FF5C8A":"rgba(255,92,138,0.08)",border:`1px solid ${isParlayLegSelected(underLeg.id)?"#FF5C8A":"rgba(255,92,138,0.2)"}`,borderRadius:10,padding:"10px 0",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#4A5066",fontWeight:700}}>UNDER {current.line}</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:isParlayLegSelected(underLeg.id)?"#06070D":"#FF5C8A"}}>{current.underOdds.american}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

    
    {/* PREDICTION MARKET */}
{section==="predict"&&(()=>{
  const PREDICTIONS = [
    { id:"goals_2plus", question:(p)=>`will ${p.name} score 2+ goals next game?`, field:"goals", threshold:2, type:"over" },
    { id:"own_goal",    question:()=>"will anyone score an own goal this week?",   field:"ourScore", threshold:0, type:"special" },
    { id:"save_3plus",  question:(p)=>`will ${p.name} get 3+ saves next game?`,   field:"saves",  threshold:3, type:"over" },
    { id:"assist_2",    question:(p)=>`will ${p.name} get 2+ assists?`,            field:"assists",threshold:2, type:"over" },
      { id:"win_streak",  question:()=>"will the team win 3 in a row this week?",    field:null,     threshold:3, type:"streak" },
    { id:"shutout",     question:(p)=>`will ${p.name} have 0 goals scored against them?`, field:"theirScore", threshold:0, type:"exact" },
  ];

  const weekStart = getWeekStart();
  const recentGames = stats.filter(g => g.mode==="3v3" && new Date(g.ts) >= weekStart);

  const buildCards = () => {
    const cards = [];
    PLAYERS.filter(p => p.id !== currentPlayer).forEach(player => {
      const pg = stats.filter(g => g.playerId===player.id && g.mode==="3v3");
      PREDICTIONS.filter(pred => pred.type !== "special" && pred.type !== "streak").forEach(pred => {
        const hitRate = pg.length ? pg.filter(g => (g[pred.field]||0) >= pred.threshold).length / pg.length : 0.5;
        const yesPct  = Math.max(0.08, Math.min(0.92, hitRate));
        const noPct   = 1 - yesPct;
        const yesOdds = calcOdds(yesPct);
        const noOdds  = calcOdds(noPct);
        cards.push({ id:`${player.id}_${pred.id}`, player, pred, yesPct, noPct, yesOdds, noOdds, gamesPlayed: pg.length });
      });
    });
    // team-level predictions
    [PREDICTIONS.find(p=>p.id==="win_streak"), PREDICTIONS.find(p=>p.id==="own_goal")].forEach(pred => {
      if (!pred) return;
      cards.push({ id:`team_${pred.id}`, player: null, pred, yesPct:0.35, noPct:0.65, yesOdds: calcOdds(0.35), noOdds: calcOdds(0.65), gamesPlayed: recentGames.length });
    });
    return cards;
  };

  const predCards = buildCards();
  const myPredBets = (bets||[]).filter(b => b.bettorId===currentPlayer && b.isPrediction && b.status==="open");

  const placePredBet = async (card, side, wager) => {
    if (myPoints < wager) return;
    const odds = side==="yes" ? card.yesOdds : card.noOdds;
    const payout = calcPayout(wager, odds.decimal);
    const bet = {
      id: Date.now().toString(),
      bettorId: currentPlayer,
      isPrediction: true,
      predId: card.id,
      question: card.player ? card.pred.question(card.player) : card.pred.question(),
      playerId: card.player?.id || null,
      field: card.pred.field,
      threshold: card.pred.threshold,
      predType: card.pred.type,
      side,
      wager,
      payout,
      odds: odds.american,
      status: "open",
      placedAt: new Date().toISOString(),
    };
    const upd = { ...points, [currentPlayer]: myPoints - wager };
    setPoints(upd); await storeSet("points", upd);
    const updBets = [...(bets||[]), bet];
    setBets(updBets); await storeSet("bets", updBets);
  };
    
  return (
    <div>
      <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>predict what happens in upcoming games. live odds based on real stats. all predictions resolve at end of week.</div>

      <div style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:14,border:"1px solid rgba(255,255,255,0.05)"}}>
        <div style={{fontSize:11,color:"#4A5066",fontWeight:700,marginBottom:8}}>WAGER</div>
        <div style={{display:"flex",gap:8}}>
          {[5,10,25,50].map(amt=>(
            <button key={amt} onClick={()=>setPredWager(amt)} className="bb-pressable"
              style={{flex:1,background:predWager===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"7px 0",fontSize:11,fontWeight:700,color:predWager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
              {amt}
            </button>
          ))}
        </div>
      </div>

      {predCards.map(card => {
        const isSelected = selectedPred===card.id;
        const question = card.player ? card.pred.question(card.player) : card.pred.question();
        const alreadyBet = myPredBets.find(b => b.predId===card.id);
        return (
          <div key={card.id} style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:`1px solid ${isSelected?"rgba(255,209,102,0.3)":"rgba(255,255,255,0.05)"}`}}>
            {card.player && (
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <div style={{width:7,height:7,borderRadius:99,background:card.player.color}}/>
                <span style={{fontSize:11,fontWeight:700,color:card.player.color}}>{card.player.name}</span>
                <span style={{fontSize:10,color:"#4A5066",marginLeft:"auto"}}>{card.gamesPlayed}g history</span>
              </div>
            )}
            <div style={{fontSize:13.5,fontWeight:700,color:"#E8ECF4",marginBottom:10,lineHeight:1.4}}>{question}</div>
            {alreadyBet ? (
              <div style={{fontSize:11,color:"#FFD166",fontWeight:700,background:"rgba(255,209,102,0.08)",borderRadius:8,padding:"8px 10px"}}>
                you bet {alreadyBet.side.toUpperCase()} · {alreadyBet.wager} pts to win {alreadyBet.payout} · {alreadyBet.odds}
              </div>
            ) : (
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setSelectedPred(card.id);setPredSide("yes");placePredBet(card,"yes",predWager);}} disabled={myPoints<predWager} className="bb-pressable"
                  style={{flex:1,background:"rgba(124,255,178,0.08)",border:"1px solid rgba(124,255,178,0.2)",borderRadius:10,padding:"10px 0",cursor:myPoints>=predWager?"pointer":"default",textAlign:"center",opacity:myPoints<predWager?0.4:1}}>
                  <div style={{fontSize:10,color:"#4A5066",fontWeight:700,marginBottom:2}}>YES</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#7CFFB2"}}>{card.yesOdds.american}</div>
                  <div style={{fontSize:9,color:"#4A5066",marginTop:2}}>{Math.round(card.yesPct*100)}% hist.</div>
                </button>
                <button onClick={()=>{setSelectedPred(card.id);setPredSide("no");placePredBet(card,"no",predWager);}} disabled={myPoints<predWager} className="bb-pressable"
                  style={{flex:1,background:"rgba(255,92,138,0.08)",border:"1px solid rgba(255,92,138,0.2)",borderRadius:10,padding:"10px 0",cursor:myPoints>=predWager?"pointer":"default",textAlign:"center",opacity:myPoints<predWager?0.4:1}}>
                  <div style={{fontSize:10,color:"#4A5066",fontWeight:700,marginBottom:2}}>NO</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#FF5C8A"}}>{card.noOdds.american}</div>
                  <div style={{fontSize:9,color:"#4A5066",marginTop:2}}>{Math.round(card.noPct*100)}% hist.</div>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {predCards.length===0 && <div style={s.emptyQueue}>log some 3v3 games first — predictions unlock once there's game history.</div>}
    </div>
  );
})()}

      {/* MY BETS */}
      {section==="mybets"&&(
        <div>
          {myOpenBets.length===0&&mySettledBets.length===0&&<div style={s.emptyQueue}>no bets yet — head to props or spin the wheel.</div>}
          {myOpenBets.length>0&&(
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={s.sectionLabel}>open bets</div>
                <button onClick={cancelAllOpenBets} className="bb-pressable" style={{background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.25)",borderRadius:9,padding:"6px 10px",fontSize:10.5,fontWeight:700,color:"#FF5C8A",cursor:"pointer"}}>trash all</button>
              </div>
              {myOpenBets.map(bet=>(
                <div key={bet.id} style={{background:"#11131F",borderRadius:13,padding:14,marginBottom:8,border:"1px solid rgba(255,209,102,0.2)",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontSize:13,fontWeight:700,color:"#FFD166"}}>{bet.playerName} {bet.side} {bet.line} {bet.field}</span>
                      <span style={{fontSize:11,color:"#4A5066"}}>{bet.odds}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontSize:12,color:"#8B92A8"}}>wagered {bet.wager} pts</span>
                      <span style={{fontSize:12,color:"#B8FF4D",fontWeight:700}}>win {bet.payout} pts</span>
                    </div>
                    <div style={{fontSize:10,color:"#4A5066",marginTop:4}}>waiting for {bet.playerName} to log a 3v3 game · cancelled bets are not refunded</div>
                  </div>
                  <button onClick={()=>cancelOpenBet(bet.id)} className="bb-pressable" style={{background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.25)",borderRadius:10,width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",color:"#FF5C8A",cursor:"pointer",flexShrink:0}}>
                    <X size={16}/>
                  </button>
                </div>
              ))}
            </>
          )}
          {mySettledBets.length>0&&(
            <>
              <div style={{...s.sectionLabel,marginBottom:10,marginTop:16}}>settled by day</div>
              {Object.entries(mySettledBets.reduce((acc, bet) => {
                const dk = dateKey(new Date(bet.settledAt || bet.placedAt || Date.now()));
                if (!acc[dk]) acc[dk] = [];
                acc[dk].push(bet);
                return acc;
              }, {})).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(([dk, dayBets]) => {
                const byPlayer = dayBets.reduce((acc, bet) => {
                  const name = PLAYERS.find(p=>p.id===bet.bettorId)?.name || bet.bettorName || "player";
                  if (!acc[name]) acc[name] = [];
                  acc[name].push(bet);
                  return acc;
                }, {});
                return (
                  <div key={dk} style={{background:"#11131F",borderRadius:14,padding:14,marginBottom:10,border:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:12,fontWeight:800,color:"#B8FF4D"}}>{fmtDay(new Date(dk+"T00:00:00"))}</div>
                      <div style={{fontSize:10,color:"#4A5066",fontWeight:800}}>{dayBets.length} bet{dayBets.length!==1?"s":""}</div>
                    </div>
                    {Object.entries(byPlayer).map(([name, betsForPlayer]) => (
                      <div key={name} style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                        <div style={{fontSize:11,color:"#8B92A8",fontWeight:800,marginBottom:6}}>{name} · {betsForPlayer.length}</div>
                        {betsForPlayer.map(bet=>{
                          const won = bet.status==="won";
                          return (
                            <div key={bet.id} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:5,fontSize:11}}>
                              <span style={{color:"#E8ECF4"}}>{bet.playerName} {bet.side} {bet.line} {bet.field}</span>
                              <span style={{fontWeight:800,color:won?"#7CFFB2":"#FF5C8A"}}>{won?"WON":"LOST"}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
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
                  
// ===================== Coin Flip Duel =====================
function CoinFlipTab({ currentPlayer, points, setPoints, coinFlips, setCoinFlips, flipChallenges, setFlipChallenges, pings, setPings, addToast }) {
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [wager, setWager] = useState(10);
  const [flipping, setFlipping] = useState(false);
  const [result, setResult] = useState(null);
  const [showAllFlipHistory, setShowAllFlipHistory] = useState(false);
  const myPoints = points?.[currentPlayer] || 0;
  const weekStart = getWeekStart();
  const weekFlipKey = `coinflips_used_${currentPlayer}_${dateKey(weekStart)}`;
  const flipsUsedThisWeek = points?.[weekFlipKey] || 0;
  const WEEKLY_FLIP_LIMIT = 3;
  const flipsLeft = Math.max(0, WEEKLY_FLIP_LIMIT - flipsUsedThisWeek);
  const opponents = PLAYERS.filter(p => p.id !== currentPlayer);

  const incomingChallenges = (flipChallenges||[]).filter(c =>
    c.to === currentPlayer && c.status === "pending" &&
    Date.now() - new Date(c.ts).getTime() < 3600000
  );
  const outgoingChallenge = (flipChallenges||[]).find(c =>
    c.from === currentPlayer && c.status === "pending" &&
    Date.now() - new Date(c.ts).getTime() < 3600000
  );

  const sendChallenge = async () => {
    if (!selectedOpponent || myPoints < wager || flipsLeft <= 0) return;
    const challenge = {
      id: Date.now().toString(),
      from: currentPlayer,
      to: selectedOpponent,
      wager,
      status: "pending",
      ts: new Date().toISOString(),
    };
    const filtered = (flipChallenges||[]).filter(c => !(c.from === currentPlayer && c.status === "pending"));
    const upd = [...filtered, challenge];
    setFlipChallenges(upd);
    await storeSet("flip_challenges", upd);
    const pingEntry = {
      id: (Date.now()+1).toString(),
      from: currentPlayer,
      to: selectedOpponent,
      ts: new Date().toISOString(),
      type: "coinflip",
      wager,
    };
    const pingUpd = [...(pings||[]), pingEntry];
    setPings(pingUpd);
    await storeSet("pings", pingUpd);
    addToast?.(`challenge sent to ${PLAYERS.find(p => p.id === selectedOpponent)?.name}!`, "🪙");
  };

  const acceptChallenge = async (challenge) => {
    const opponentPts = points?.[challenge.from] || 0;
    if (myPoints < challenge.wager || opponentPts < challenge.wager) return;
    setFlipping(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 950));
    const iWin = Math.random() < 0.5;
    const winner = iWin ? currentPlayer : challenge.from;
    const loser = iWin ? challenge.from : currentPlayer;
    const outcome = {
      id: Date.now().toString(),
      challenger: challenge.from,
      opponent: currentPlayer,
      wager: challenge.wager,
      winner,
      ts: new Date().toISOString(),
    };
    const newPts = {
      ...points,
      [winner]: (points?.[winner] || 0) + challenge.wager,
      [loser]: Math.max(0, (points?.[loser] || 0) - challenge.wager),
      [weekFlipKey]: flipsUsedThisWeek + 1,
    };
    setPoints(newPts);
    await storeSet("points", newPts);
    const updFlips = [...(coinFlips||[]), outcome];
    setCoinFlips(updFlips);
    await storeSet("coin_flips", updFlips);
    const updChallenges = (flipChallenges||[]).map(c =>
      c.id === challenge.id ? { ...c, status: "settled", winner } : c
    );
    setFlipChallenges(updChallenges);
    await storeSet("flip_challenges", updChallenges);
    setResult({ ...outcome, won: winner === currentPlayer });
    setFlipping(false);
  };

  const declineChallenge = async (challenge) => {
    const upd = (flipChallenges||[]).map(c =>
      c.id === challenge.id ? { ...c, status: "declined" } : c
    );
    setFlipChallenges(upd);
    await storeSet("flip_challenges", upd);
  };

  const cancelOutgoing = async () => {
    if (!outgoingChallenge) return;
    const upd = (flipChallenges||[]).map(c =>
      c.id === outgoingChallenge.id ? { ...c, status: "cancelled" } : c
    );
    setFlipChallenges(upd);
    await storeSet("flip_challenges", upd);
  };

  const myHistory = (coinFlips||[])
    .filter(f => f.challenger === currentPlayer || f.opponent === currentPlayer)
    .slice(-10)
    .reverse();

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={{fontSize:11,color:"#4A5066",marginBottom:16,lineHeight:1.5}}>
        challenge a teammate. they get a notification and must accept. winner takes the pts.
      </div>

      {/* Balance */}
      <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:"1px solid rgba(255,209,102,0.2)",borderRadius:16,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:2}}>YOUR BALANCE</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:600,color:"#FFD166"}}>{myPoints}<span style={{fontSize:12,color:"#4A5066",marginLeft:4}}>pts</span></div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:36}}>🪙</div>
          <div style={{fontSize:10,color:"#4A5066",marginTop:4}}>{flipsLeft} flips left this week</div>
        </div>
      </div>

      {/* Incoming challenges */}
      {incomingChallenges.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{...s.sectionLabel,marginBottom:8}}>⚡ incoming challenges</div>
          {incomingChallenges.map(c => {
            const challenger = PLAYERS.find(p => p.id === c.from);
            const canAfford = myPoints >= c.wager && (points?.[c.from] || 0) >= c.wager;
            return (
              <div key={c.id} style={{background:"rgba(255,209,102,0.08)",border:"1px solid rgba(255,209,102,0.35)",borderRadius:16,padding:"16px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <span style={{fontSize:26}}>🪙</span>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:"#FFD166"}}>{challenger?.name} challenges you!</div>
                    <div style={{fontSize:11,color:"#8B92A8",marginTop:2}}>wager: <span style={{color:"#FFD166",fontWeight:700}}>{c.wager} pts</span> · {fmtRelTime(c.ts)}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={() => declineChallenge(c)} className="bb-pressable"
                    style={{flex:1,background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.3)",borderRadius:10,padding:"11px 0",fontSize:12,fontWeight:700,color:"#FF5C8A",cursor:"pointer"}}>
                    decline
                  </button>
                  <button
                    onClick={() => acceptChallenge(c)}
                    disabled={!canAfford || flipping}
                    className="bb-pressable bb-glow-lime"
                    style={{flex:2,background:canAfford&&!flipping?"#FFD166":"rgba(255,255,255,0.05)",border:"none",borderRadius:10,padding:"11px 0",fontSize:12,fontWeight:700,color:canAfford&&!flipping?"#06070D":"#4A5066",cursor:canAfford&&!flipping?"pointer":"default"}}>
                    {flipping ? "flipping…" : canAfford ? `accept — ${c.wager} pts` : "can't afford"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Outgoing pending */}
      {outgoingChallenge && (
        <div style={{background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:14,padding:14,marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#A78BFA",marginBottom:4}}>⏳ waiting for response</div>
          <div style={{fontSize:12,color:"#8B92A8",marginBottom:10}}>
            you challenged <span style={{color:"#E8ECF4",fontWeight:700}}>{PLAYERS.find(p => p.id === outgoingChallenge.to)?.name}</span> for <span style={{color:"#FFD166",fontWeight:700}}>{outgoingChallenge.wager} pts</span>
          </div>
          <button onClick={cancelOutgoing} className="bb-pressable"
            style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 14px",fontSize:11,color:"#4A5066",cursor:"pointer"}}>
            cancel challenge
          </button>
        </div>
      )}

      {/* Coin animation */}
      <div style={{textAlign:"center",marginBottom:20,marginTop:4,perspective:900}}>
        <div style={{
          width: flipping ? 76 : 64,
          height: flipping ? 76 : 64,
          borderRadius:"50%",
          margin:"0 auto",
          position:"relative",
          overflow:"hidden",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          background:"radial-gradient(circle at 32% 26%, #FFF8B8 0%, #FFD166 38%, #B97A1F 100%)",
          border:"3px solid rgba(255,255,255,0.28)",
          boxShadow: result
            ? result.won
              ? "0 0 24px rgba(255,209,102,.75), inset 0 0 18px rgba(255,255,255,.22)"
              : "0 0 24px rgba(255,92,138,.55), inset 0 0 18px rgba(255,255,255,.18)"
            : "0 12px 28px rgba(0,0,0,.28), inset 0 0 18px rgba(255,255,255,.18)",
          animation: flipping ? "coinFlipReal .78s linear infinite" : "none",
          transformStyle:"preserve-3d",
          backfaceVisibility:"hidden",
          willChange:"transform",
          transition:"width .18s ease, height .18s ease, box-shadow .2s ease",
        }}>
          <div style={{position:"absolute",inset:7,borderRadius:"50%",border:"2px solid rgba(86,52,10,.28)"}} />
          <div style={{position:"absolute",top:-18,bottom:-18,width:18,background:"rgba(255,255,255,.65)",filter:"blur(8px)",animation:flipping?"coinShine .78s linear infinite":"none"}} />
          <div style={{fontSize:22,fontWeight:900,color:"#5C3908",textShadow:"0 1px 0 rgba(255,255,255,.35)",letterSpacing:.5}}>BB</div>
        </div>
      </div>

      {/* Result */}
      {result && !flipping && (
        <div style={{background:result.won?"rgba(124,255,178,0.08)":"rgba(255,92,138,0.08)",border:`1px solid ${result.won?"rgba(124,255,178,0.3)":"rgba(255,92,138,0.3)"}`,borderRadius:16,padding:"20px",marginBottom:16,textAlign:"center",animation:"scaleFadeIn .3s cubic-bezier(.2,.8,.2,1)"}}>
          <div style={{fontSize:32,marginBottom:8}}>{result.won ? "🎉" : "💀"}</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:700,color:result.won?"#7CFFB2":"#FF5C8A",marginBottom:4}}>
            {result.won ? "you win!" : "you lose"}
          </div>
          <div style={{fontSize:13,color:"#8B92A8"}}>
            {result.won ? `+${result.wager} pts` : `-${result.wager} pts`} vs {PLAYERS.find(p => p.id === (result.challenger === currentPlayer ? result.opponent : result.challenger))?.name}
          </div>
        </div>
      )}

      {/* Send challenge form — only show if no outgoing pending */}
      {!outgoingChallenge && (
        <>
          <div style={{...s.sectionLabel,marginBottom:10}}>send a challenge</div>

          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {opponents.map(p => (
              <button key={p.id} onClick={() => setSelectedOpponent(p.id)} className="bb-pressable"
                style={{flex:1,background:selectedOpponent===p.id?p.color:"rgba(255,255,255,0.05)",border:`1px solid ${selectedOpponent===p.id?p.color:"rgba(255,255,255,0.08)"}`,borderRadius:12,padding:"12px 0",fontSize:12,fontWeight:700,color:selectedOpponent===p.id?"#06070D":"#8B92A8",cursor:"pointer"}}>
                {p.name}
              </button>
            ))}
          </div>

          <div style={{...s.sectionLabel,marginBottom:8}}>wager</div>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[10, 25, 50, 100, 250].map(amt => (
              <button key={amt} onClick={() => setWager(amt)} className="bb-pressable"
                style={{flex:1,background:wager===amt?"#FFD166":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"8px 0",fontSize:11,fontWeight:700,color:wager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
                {amt}
              </button>
            ))}
          </div>

          <button
            onClick={sendChallenge}
            disabled={!selectedOpponent || myPoints < wager || flipsLeft <= 0}
            className="bb-pressable bb-glow-lime"
            style={{
              ...s.primaryBtn,
              background: !selectedOpponent || myPoints < wager || flipsLeft <= 0
                ? "rgba(255,255,255,0.05)"
                : "#FFD166",
              color: !selectedOpponent || myPoints < wager || flipsLeft <= 0
                ? "#4A5066"
                : "#06070D",
              fontFamily: "'Oswald',sans-serif",
              fontSize: 16,
              letterSpacing: 1,
            }}>
            {flipsLeft <= 0
              ? "no flips left this week"
              : !selectedOpponent
              ? "pick an opponent first"
              : myPoints < wager
              ? "not enough pts"
              : `send challenge — ${wager} pts · ${flipsLeft} left`}
          </button>
        </>
      )}

      {/* History */}
      {myHistory.length > 0 && (
        <>
          <div style={{...s.sectionLabel,marginBottom:10,marginTop:24}}>recent flips</div>
          {(showAllFlipHistory ? myHistory : myHistory.slice(0,5)).map(f => {
            const iWon = f.winner === currentPlayer;
            const otherId = f.challenger === currentPlayer ? f.opponent : f.challenger;
            const other = PLAYERS.find(p => p.id === otherId);
            return (
              <div key={f.id} style={{background:"#11131F",borderRadius:13,padding:"12px 14px",marginBottom:8,border:`1px solid ${iWon?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:iWon?"#7CFFB2":"#FF5C8A"}}>
                    {iWon ? "won" : "lost"} vs {other?.name}
                  </div>
                  <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{fmtRelTime(f.ts)}</div>
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:iWon?"#7CFFB2":"#FF5C8A"}}>
                  {iWon ? "+" : "-"}{f.wager} pts
                </div>
              </div>
            );
          })}
          {myHistory.length > 5 && (
            <button onClick={()=>setShowAllFlipHistory(v=>!v)} className="bb-pressable"
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"11px 0",fontSize:12,fontWeight:700,color:"#8B92A8",cursor:"pointer",marginTop:4}}>
              {showAllFlipHistory ? "▲ view less" : `▼ view more (${myHistory.length - 5})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ===================== Race Mode =====================
const RACE_OBJECTIVES = [
  { id:"shots_100",    label:"100 Shots",    field:"shots",   target:100, emoji:"🎯", color:"#B8FF4D" },
  { id:"saves_20",     label:"20 Saves",     field:"saves",   target:20,  emoji:"🧤", color:"#4D9EFF" },
  { id:"assists_15",   label:"15 Assists",   field:"assists", target:15,  emoji:"🍀", color:"#A78BFA" },
  { id:"goals_50",     label:"50 Goals",     field:"goals",   target:50,  emoji:"⚽", color:"#FFD166" },
  { id:"demos_30",     label:"30 Demos",     field:"demos",   target:30,  emoji:"💥", color:"#FF8C42" },
  { id:"wins_10",      label:"10 Wins",      field:null,      target:10,  emoji:"🏆", color:"#FF61C1" },
];

function RaceModeTab({ stats, currentPlayer, points, setPoints, activeRace, setActiveRace, raceStart, setRaceStart }) {

  const weekStart = getWeekStart();

  const getProgress = (playerId, objective) => {
    const cutoff = raceStart ? new Date(raceStart) : weekStart;
    const pg = stats.filter(g =>
      g.playerId === playerId &&
      g.mode === "3v3" &&
      new Date(g.ts) >= cutoff
    );
    if (objective.field === null) {
      return pg.filter(g => g.ourScore > g.theirScore).length;
    }
    return pg.reduce((s, g) => s + (g[objective.field] || 0), 0);
  };
const startRace = async (obj) => {
    const existing = await storeGet("active_race");
    if (existing && existing.objectiveId) return; // already one running
    const ts = new Date().toISOString();
    const raceData = { objectiveId: obj.id, startedAt: ts, startedBy: currentPlayer };
    setActiveRace(obj.id);
    setRaceStart(ts);
    await storeSet("active_race", raceData);
  };
const endRace = async () => {
    setActiveRace(null);
    setRaceStart(null);
    await storeSet("active_race", { objectiveId: null, cancelled: true, cancelledBy: currentPlayer, cancelledAt: new Date().toISOString() });
  };
  const currentObj = RACE_OBJECTIVES.find(o => o.id === activeRace);
  const raceEndsAt = raceStart ? new Date(new Date(raceStart).getTime() + 3 * DAY_MS) : null;
  const raceMsLeft = raceEndsAt ? Math.max(0, raceEndsAt.getTime() - Date.now()) : 0;
  const raceTimeLeftLabel = raceEndsAt ? `${Math.floor(raceMsLeft / DAY_MS)}d ${String(Math.floor((raceMsLeft % DAY_MS) / 3600000)).padStart(2,"0")}h ${String(Math.floor((raceMsLeft % 3600000) / 60000)).padStart(2,"0")}m left` : "";

  const leaderboard = currentObj
    ? [...PLAYERS].map(p => ({
        player: p,
        progress: getProgress(p.id, currentObj),
      })).sort((a, b) => b.progress - a.progress)
    : [];

  const winner = leaderboard.find(l => l.progress >= (currentObj?.target || 0));

  const settleRace = async (reason = "manual") => {
    if (!currentObj || !activeRace) return;
    const savedRace = await storeGet("active_race");
    if (!savedRace?.objectiveId || savedRace.settledAt) return;
    const raceWinner = winner || leaderboard[0];
    const pts = await storeGet("points") || {};
    let updPts = pts;
    if (raceWinner?.player?.id) {
      updPts = { ...pts, [raceWinner.player.id]: (pts[raceWinner.player.id] || 0) + 50 };
      setPoints(updPts);
      await storeSet("points", updPts);
    }
    setActiveRace(null);
    setRaceStart(null);
    await storeSet("active_race", { objectiveId:null, settled:true, settledAt:new Date().toISOString(), settledBy:currentPlayer, winnerId:raceWinner?.player?.id || null, reason });
  };

  useEffect(() => {
    if (!activeRace || !raceEndsAt) return;
    const delay = Math.max(400, raceEndsAt.getTime() - Date.now());
    const id = setTimeout(() => { settleRace("timer"); }, delay);
    return () => clearTimeout(id);
  }, [activeRace, raceStart, stats]);

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      {!activeRace ? (
        <>
          <div style={{...s.sectionLabel,marginBottom:12}}>pick an objective</div>
          {RACE_OBJECTIVES.map(obj => (
            <button key={obj.id} onClick={() => startRace(obj)} disabled={!!activeRace} className="bb-pressable"
              style={{width:"100%",background:"linear-gradient(135deg,#11131F,#0C0E18)",border:`1px solid ${obj.color}22`,borderRadius:16,padding:"16px",marginBottom:10,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:14}}>
              <span style={{fontSize:32}}>{obj.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:obj.color}}>{obj.label}</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:3}}>first to {obj.target} · winner gets +50 pts bonus</div>
              </div>
              <ChevronRight size={16} color="#4A5066"/>
            </button>
          ))}
        </>
      ) : (
        <>
          {/* Active race header */}
          <div style={{background:`linear-gradient(135deg,${currentObj.color}18,${currentObj.color}08)`,border:`1px solid ${currentObj.color}40`,borderRadius:18,padding:"18px",marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:11,color:currentObj.color,fontWeight:700,letterSpacing:1,marginBottom:6}}>RACE IN PROGRESS</div>
            <div style={{fontSize:42,marginBottom:6}}>{currentObj.emoji}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#E8ECF4",marginBottom:4}}>{currentObj.label}</div>
            <div style={{fontSize:12,color:"#8B92A8"}}>first to {currentObj.target} wins +50 pts</div>
            {raceStart && <div style={{fontSize:11,color:"#4A5066",marginTop:6}}>started {fmtRelTime(raceStart)} · closes in {raceTimeLeftLabel}</div>}
          </div>

          {/* Winner banner */}
          {winner && (
            <div style={{background:"linear-gradient(135deg,rgba(255,209,102,0.15),rgba(255,209,102,0.05))",border:"1px solid rgba(255,209,102,0.4)",borderRadius:16,padding:"18px",marginBottom:16,textAlign:"center"}}>
              <div style={{fontSize:32,marginBottom:6}}>🏆</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#FFD166",marginBottom:4}}>
                {winner.player.name} wins!
              </div>
              <div style={{fontSize:12,color:"#8B92A8"}}>+50 pts bonus awarded</div>
              <button onClick={()=>settleRace("winner")} className="bb-pressable bb-glow-lime"
                style={{...s.primaryBtn,marginTop:12,background:"#FFD166",color:"#06070D"}}>
                settle race
              </button>
            </div>
          )}

          {/* Leaderboard */}
          <div style={{...s.sectionLabel,marginBottom:12}}>standings</div>
          {leaderboard.map((entry, i) => {
            const pct = Math.min(1, entry.progress / currentObj.target);
            const isMe = entry.player.id === currentPlayer;
            return (
              <div key={entry.player.id} style={{background:isMe?"linear-gradient(135deg,#11131F,#0C0E18)":"#11131F",borderRadius:14,padding:"14px 16px",marginBottom:10,border:`1px solid ${isMe?entry.player.color+"33":"rgba(255,255,255,0.05)"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:i===0?"#FFD166":"#4A5066",width:24}}>{i+1}</div>
                  <div style={{width:9,height:9,borderRadius:99,background:entry.player.color,boxShadow:`0 0 8px ${entry.player.color}99`}}/>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:entry.player.color,flex:1}}>{entry.player.name}</span>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:entry.player.color}}>
                    {entry.progress}<span style={{fontSize:11,color:"#4A5066",marginLeft:3}}>/ {currentObj.target}</span>
                  </div>
                </div>
                <div style={{height:8,background:"rgba(255,255,255,0.08)",borderRadius:99,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct*100}%`,background:pct>=1?"#FFD166":entry.player.color,borderRadius:99,transition:"width .4s ease",boxShadow:pct>=1?`0 0 8px #FFD16699`:`0 0 6px ${entry.player.color}88`}}/>
                </div>
                {pct >= 1 && <div style={{fontSize:11,color:"#FFD166",fontWeight:700,marginTop:6}}>🏆 finished!</div>}
              </div>
            );
          })}

          {!winner && (
            <button onClick={endRace} className="bb-pressable"
              style={{width:"100%",background:"rgba(255,92,138,0.08)",border:"1px solid rgba(255,92,138,0.2)",borderRadius:12,padding:"12px 0",fontSize:12,fontWeight:700,color:"#FF5C8A",cursor:"pointer",marginTop:8}}>
              cancel race
            </button>
          )}
        </>
      )}
    </div>
  );
}        
                  
const CHEMISTRY_RESET_VERSION = 4;
function TeamChemistryTab({ stats, currentPlayer, points, setPoints, chemistry, setChemistry }) {
  const weekStart = getWeekStart();
  const [selectedDuo, setSelectedDuo] = useState(null);
  const [chemSelectedGame, setChemSelectedGame] = useState(null);
  const getSyncedCountKey = (key) => `${key}_syncedCount`;
  useEffect(() => {
    if (chemistry?._resetVersion === CHEMISTRY_RESET_VERSION) return;
    const wiped = { _resetVersion: CHEMISTRY_RESET_VERSION };
    setChemistry(wiped);
    storeSet("chemistry", wiped);
  }, [chemistry?._resetVersion]);
  const [duoSwipeOffset, setDuoSwipeOffset] = useState(0);
  const duoSwipeStartX = useRef(0);
  const duoSwipeStartY = useRef(0);
  const handleDuoTouchStart = (e) => {
    duoSwipeStartX.current = e.touches[0].clientX;
    duoSwipeStartY.current = e.touches[0].clientY;
  };
  const handleDuoTouchMove = (e) => {
    const dx = e.touches[0].clientX - duoSwipeStartX.current;
    const dy = Math.abs(e.touches[0].clientY - duoSwipeStartY.current);
    if (dx > 0 && dx > dy) setDuoSwipeOffset(dx);
  };
  const handleDuoTouchEnd = () => {
    if (duoSwipeOffset > 80) {
      setSelectedDuo(null);
      setDuoSwipeOffset(0);
    } else {
      setDuoSwipeOffset(0);
    }
  };

// award chemistry XP — only pays out for shared games not already counted
const syncChemXP = async (pid1, pid2, sharedGamesList) => {
  const key = `2v2_${getChemistryKey(pid1, pid2)}`;
  const countKey = getSyncedCountKey(key);
  const alreadySynced = chemistry?.[countKey] || 0;
  const newGamesCount = sharedGamesList.length - alreadySynced;

  if (newGamesCount <= 0) return;

  const newGames = sharedGamesList.slice(alreadySynced);
  const newWins = newGames.filter(p => gameIsWin(p.p1game)).length;

  const xpGain = newWins * 5 + newGamesCount * 2;
  const current = chemistry?.[key] || 0;

  const upd = {
    ...chemistry,
    [key]: current + xpGain,
    [countKey]: sharedGamesList.length
  };

  setChemistry(upd);
  await storeSet("chemistry", upd);
};

const myPairs = CHEMISTRY_PAIRS.filter(pair => pair.includes(currentPlayer));

// Compute chemistry from this week's shared games
const SHARED_GAME_WINDOW_MS = 10 * 60 * 1000;

const getSharedGames = (pid1, pid2, allTime = false) => {
  const p1Games = stats.filter(
    g =>
      g.playerId === pid1 &&
      g.mode === "2v2" &&
      (g.duoIds?.includes(pid2) || g.sessionCode) &&
      (allTime || new Date(g.ts) >= weekStart)
  );

  const p2Games = stats.filter(
    g =>
      g.playerId === pid2 &&
      g.mode === "2v2" &&
      (g.duoIds?.includes(pid1) || g.sessionCode) &&
      (allTime || new Date(g.ts) >= weekStart)
  );

  const linked = [];
  const usedP2Ids = new Set();

  p1Games.forEach(g1 => {
    let match = g1.sessionCode
      ? p2Games.find(
          g2 =>
            !usedP2Ids.has(g2.id) &&
            g2.sessionCode === g1.sessionCode &&
            g2.mode === g1.mode
        )
      : null;

    if (match) {
      linked.push({ p1game: g1, p2game: match });
      usedP2Ids.add(match.id);
    }
  });

  return linked;
};

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={{ fontSize:11, color:"#4A5066", marginBottom:16, lineHeight:1.5 }}>
        chemistry now only builds from synced 2v2 duo matches. sync a 2v2 duo in Stats first, then come here to sync chemistry fresh.
      </div>

      {CHEMISTRY_PAIRS.map(([pid1, pid2]) => {
        const key = `2v2_${getChemistryKey(pid1, pid2)}`;
        const chemXP = chemistry?.[key] || 0;
        const lvl = getChemistryLevel(chemXP);
        const bonus = getChemistryBonus(chemXP);
        const p1 = PLAYERS.find(p => p.id === pid1);
        const p2 = PLAYERS.find(p => p.id === pid2);
   const shared = getSharedGames(pid1, pid2);
        const sharedAllTime = getSharedGames(pid1, pid2, true);
        const sharedWins = shared.filter(p => gameIsWin(p.p1game)).length;
        const earnedBadges = getEarnedDuoBadges(sharedAllTime, lvl.level);
        const isMyPair = pid1 === currentPlayer || pid2 === currentPlayer;
        const nextLvlXP = [10,60,150,300,500,999][lvl.level];
        const prevLvlXP = [0,10,60,150,300,500][lvl.level];
        const pct = lvl.level >= 5 ? 1 : (chemXP - prevLvlXP) / (nextLvlXP - prevLvlXP);

        return (
          <div key={key} onClick={() => setSelectedDuo({ pid1, pid2 })} className="bb-pressable" style={{ background: isMyPair ? "linear-gradient(135deg,#11131F,#0C0E18)" : "#11131F", borderRadius:18, padding:"16px", marginBottom:14, border:`1px solid ${isMyPair ? lvl.color+"44" : "rgba(255,255,255,0.05)"}`, boxShadow: isMyPair ? `0 0 20px ${lvl.color}10` : "none", cursor:"pointer" }}>
            {/* Duo header */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:99, background:p1.color, boxShadow:`0 0 6px ${p1.color}88` }}/>
                  <span style={{ fontSize:13, fontWeight:700, color:p1.color }}>{p1.name}</span>
                </div>
                <span style={{ fontSize:11, color:"#4A5066" }}>×</span>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:10, height:10, borderRadius:99, background:p2.color, boxShadow:`0 0 6px ${p2.color}88` }}/>
                  <span style={{ fontSize:13, fontWeight:700, color:p2.color }}>{p2.name}</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:18 }}>{lvl.emoji}</div>
                <div style={{ fontSize:10, color:lvl.color, fontWeight:700, marginTop:2 }}>{lvl.label}</div>
              </div>
            </div>

            {/* XP bar */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#8B92A8", marginBottom:5 }}>
                <span style={{ color:lvl.color, fontWeight:700 }}>Lvl {lvl.level} · {chemXP} xp</span>
                <span>{lvl.level < 5 ? `${nextLvlXP} to next` : "MAX"}</span>
              </div>
              <div style={{ height:7, background:"rgba(255,255,255,0.08)", borderRadius:99, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(1,pct)*100}%`, background:lvl.color, borderRadius:99, transition:"width .4s ease", boxShadow:`0 0 8px ${lvl.color}88` }}/>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <div style={{ flex:1, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"8px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#4A5066", fontWeight:700, marginBottom:2 }}>SHARED GAMES</div>
                <div style={{ fontSize:14, fontWeight:700, color:lvl.color }}>{shared.length}</div>
              </div>
              <div style={{ flex:1, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"8px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#4A5066", fontWeight:700, marginBottom:2 }}>WINS TOGETHER</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#7CFFB2" }}>{sharedWins}</div>
              </div>
              <div style={{ flex:1, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"8px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#4A5066", fontWeight:700, marginBottom:2 }}>XP BONUS</div>
                <div style={{ fontSize:14, fontWeight:700, color:lvl.color }}>+{Math.round(bonus.xpBonus*100)}%</div>
              </div>
            </div>

 {/* Duo badges — unique achievements earned together, all-time */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {earnedBadges.length === 0 && <div style={{ fontSize:10, color:"#4A5066" }}>play together to earn your first duo badge</div>}
              {earnedBadges.map(b => (
                <div key={b.id} title={b.desc} style={{ fontSize:10, fontWeight:700, color:lvl.color, background:`${lvl.color}18`, padding:"3px 8px", borderRadius:99 }}>
                  {b.emoji} {b.label}
                </div>
              ))}
            </div>

    {/* Sync chemistry — only pays out for NEW shared games since last sync */}
            {isMyPair && (() => {
              const countKey = getSyncedCountKey(key);
              const alreadySynced = chemistry?.[countKey] || 0;
              const newCount = shared.length - alreadySynced;
              const isSynced = newCount <= 0;
              return (
                <button onClick={(e) => { e.stopPropagation(); if (!isSynced) syncChemXP(pid1, pid2, shared); }} className="bb-pressable bb-glow-lime"
                  disabled={isSynced}
                  style={{ width:"100%", background: isSynced ? "rgba(255,255,255,0.04)" : `${lvl.color}18`, border:`1px solid ${isSynced ? "rgba(255,255,255,0.08)" : lvl.color+"44"}`, borderRadius:10, padding:"10px 0", fontSize:12, fontWeight:700, color: isSynced ? "#4A5066" : lvl.color, cursor: isSynced ? "default" : "pointer", marginTop:12 }}>
                  {isSynced ? "✓ synced — up to date" : `sync chemistry (+${(() => { const newGames = shared.slice(alreadySynced); const newWins = newGames.filter(p => gameIsWin(p.p1game)).length; return newWins*5 + newCount*2; })()} xp from ${newCount} new game${newCount!==1?"s":""})`}
                </button>
              );
            })()}
          </div>
        );
      })}

      {/* Bonus info */}
      <div style={{ background:"#11131F", borderRadius:14, padding:14, border:"1px solid rgba(255,255,255,0.05)", marginTop:4 }}>
        <div style={{ fontSize:11, color:"#4A5066", fontWeight:700, marginBottom:10 }}>CHEMISTRY BONUSES</div>
        {[
          ["🌱 Fresh (Lvl 1)", "+5% xp"],
          ["🤝 Building (Lvl 2)", "+10% xp"],
          ["👯‍♂️ Close Friends (Lvl 3)", "+15% xp"],
          ["🦢 Love Birds (Lvl 4)", "+25% xp"],
          ["🧙‍♂️🧙‍♂️ Wizards (Lvl 5)", "+40% xp"],
        ].map(([label, bonus]) => (
          <div key={label} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:12 }}>
            <span style={{ color:"#E8ECF4" }}>{label}</span>
            <span style={{ color:"#B8FF4D", fontWeight:700 }}>{bonus}</span>
          </div>
        ))}
      </div>

      {/* Duo detail modal */}
      {selectedDuo && (() => {
        const { pid1, pid2 } = selectedDuo;
        const key = `2v2_${getChemistryKey(pid1, pid2)}`;
        const chemXP = chemistry?.[key] || 0;
        const lvl = getChemistryLevel(chemXP);
        const p1 = PLAYERS.find(p => p.id === pid1);
        const p2 = PLAYERS.find(p => p.id === pid2);
        const shared = getSharedGames(pid1, pid2);
        const sortedShared = [...shared].sort((a,b) => new Date(b.p1game.ts) - new Date(a.p1game.ts));
        

        return (
        <div
          onTouchStart={handleDuoTouchStart}
          onTouchMove={handleDuoTouchMove}
          onTouchEnd={handleDuoTouchEnd}
          style={{
            position:"fixed", inset:0, zIndex:400, background:"#040818",
            display:"flex", flexDirection:"column",
            animation:"scaleFadeIn .3s cubic-bezier(.2,.8,.2,1)",
            transform:`translateX(${duoSwipeOffset}px)`,
            opacity: Math.max(0, 1 - duoSwipeOffset / 280),
            transition: duoSwipeOffset === 0 ? "transform .25s ease, opacity .25s ease" : "none",
          }}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px",paddingTop:"max(16px,env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
              <button onClick={()=>setSelectedDuo(null)} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                <ChevronLeft size={18}/>
              </button>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600}}>{p1.name} × {p2.name}</div>
              <button onClick={()=>setSelectedDuo(null)} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer"}}><X size={20}/></button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 16px"}}>
         <div style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",borderRadius:18,padding:"24px",textAlign:"center",marginBottom:20,border:`1px solid ${lvl.color}33`}}>
                <div style={{fontSize:40,marginBottom:6}}>{lvl.emoji}</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,fontWeight:700,color:lvl.color}}>{lvl.label}</div>
                <div style={{fontSize:12,color:"#4A5066",marginTop:4}}>{chemXP} xp · Lvl {lvl.level}</div>
              </div>

              {(() => {
                const allTimeShared = getSharedGames(pid1, pid2, true);
                const badges = getEarnedDuoBadges(allTimeShared, lvl.level);
                return (
                  <div style={{ marginBottom:20 }}>
                    <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:10}}>DUO BADGES · {badges.length}/{DUO_BADGE_DEFS.length}</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                      {badges.length === 0 && <div style={{fontSize:12,color:"#4A5066"}}>no badges earned yet</div>}
                      {badges.map(b => (
                        <div key={b.id} style={{ background:"#11131F", border:`1px solid ${lvl.color}33`, borderRadius:12, padding:"10px 12px", minWidth:100, textAlign:"center" }}>
                          <div style={{fontSize:22,marginBottom:4}}>{b.emoji}</div>
                          <div style={{fontSize:11,fontWeight:700,color:"#E8ECF4"}}>{b.label}</div>
                          <div style={{fontSize:9,color:"#4A5066",marginTop:3,lineHeight:1.3}}>{b.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div style={{fontSize:12,color:"#4A5066",fontWeight:700,letterSpacing:1,marginBottom:12}}>SHARED GAME HISTORY · {sortedShared.length} GAMES</div>
              {sortedShared.length === 0 && <div style={{color:"#4A5066",textAlign:"center",marginTop:30,fontSize:13}}>no shared games logged this week yet</div>}
{chemSelectedGame && (
  <GameDetailModal
    game={chemSelectedGame.game}
    allPlayerGames={chemSelectedGame.allPlayerGames}
    onClose={() => setChemSelectedGame(null)}
  />
)}
{sortedShared.map(({p1game, p2game}, i) => {
  const won = p1game.result === "victory";
  const myAllGames = stats.filter(g => g.playerId === p1game.playerId && g.mode === p1game.mode).sort((a,b) => new Date(a.ts)-new Date(b.ts));
  return (
    <button key={p1game.id} onClick={() => setChemSelectedGame({ game: p1game, allPlayerGames: myAllGames })} className="bb-pressable"
      style={{width:"100%",background:"#11131F",borderRadius:13,padding:"13px 14px",marginBottom:8,border:`1px solid ${won?"rgba(124,255,178,0.15)":"rgba(255,92,138,0.1)"}`,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",textAlign:"left"}}>
      <div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#E8ECF4"}}>{p1game.ourScore}–{p1game.theirScore}</div>
        <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{fmtRelTime(p1game.ts)}{p1game.sessionCode ? ` · ${p1game.sessionCode}` : ""}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{fontSize:10,fontWeight:700,color:won?"#7CFFB2":"#FF5C8A",border:`1px solid ${won?"rgba(124,255,178,0.4)":"rgba(255,92,138,0.4)"}`,borderRadius:99,padding:"3px 9px"}}>
          {won?"WIN":"LOSS"}
        </div>
        <ChevronRight size={13} color="#4A5066"/>
      </div>
    </button>
  );
})}
            </div>
          </div>
        );
      })()}
    </div>
  );
}  
                  
// ===================== RLCS Bets =====================
// Fallback matches only show if you have not synced real matches yet.
const RLCS_MATCHES = [
  { id:"sample_m1", home:"NRG",          away:"G2 Esports",    league:"RLCS Sample", date:"sync real matches", homeOdds:"-120", awayOdds:"+105", source:"sample" },
  { id:"sample_m2", home:"Karmine Corp", away:"Vitality",      league:"RLCS Sample", date:"sync real matches", homeOdds:"+110", awayOdds:"-130", source:"sample" },
  { id:"sample_m3", home:"Team Falcons", away:"Team BDS",      league:"RLCS Sample", date:"sync real matches", homeOdds:"-105", awayOdds:"-105", source:"sample" },
];

function americanToDecimal(odds) {
  const n = parseInt(String(odds).replace("+",""));
  if (!Number.isFinite(n) || n === 0) return 2;
  return String(odds).startsWith("+") ? (n/100)+1 : (100/Math.abs(n))+1;
}

function pseudoOdds(seed, side) {
  let h = 0;
  const str = `${seed}_${side}`;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const val = 100 + (h % 65);
  const fav = h % 2 === 0;
  if (side === "home") return fav ? `-${val}` : `+${val}`;
  return fav ? `+${Math.max(100, val - 10)}` : `-${Math.max(100, val - 10)}`;
}

function fmtRlcsDate(value) {
  if (!value) return "TBD";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
}

// This accepts either your own backend's cleaned match shape OR raw PandaScore-ish objects.
function normalizeRlcsMatch(raw, idx = 0) {
  const opponents = raw?.opponents || raw?.teams || [];
  const homeObj = raw?.home || raw?.team1 || opponents?.[0]?.opponent || opponents?.[0] || {};
  const awayObj = raw?.away || raw?.team2 || opponents?.[1]?.opponent || opponents?.[1] || {};

  const home =
    raw?.homeName ||
    raw?.home ||
    homeObj?.name ||
    homeObj?.acronym ||
    raw?.team1_name ||
    "TBD";

  const away =
    raw?.awayName ||
    raw?.away ||
    awayObj?.name ||
    awayObj?.acronym ||
    raw?.team2_name ||
    "TBD";

  const id = String(raw?.id || raw?.matchId || raw?.slug || `${home}_${away}_${raw?.begin_at || raw?.date || idx}`);
  const league = raw?.league || raw?.league?.name || raw?.tournament?.name || raw?.serie?.name || raw?.name || "Rocket League";
  const beginAt = raw?.begin_at || raw?.scheduled_at || raw?.date || raw?.startTime || raw?.start_time;
  const seed = `${id}_${home}_${away}`;

  return {
    id,
    home,
    away,
    league,
    date: fmtRlcsDate(beginAt),
    beginAt,
    status: raw?.status || "upcoming",
    homeOdds: raw?.homeOdds || pseudoOdds(seed, "home"),
    awayOdds: raw?.awayOdds || pseudoOdds(seed, "away"),
    source: raw?.source || "pandascore",
  };
}

function RLCSBets({ currentPlayer, points, setPoints, bets, setBets }) {
  const RLCS_LIVE_VIDEO_ID = "hzs2x4irAD0";
  const [wager, setWager] = useState(20);
  const [placed, setPlaced] = useState({});
  const [showLive, setShowLive] = useState(false);
  const [matches, setMatches] = useState(RLCS_MATCHES);
  const [syncingMatches, setSyncingMatches] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [lastSynced, setLastSynced] = useState(null);
  const myPoints = points?.[currentPlayer] || 0;
  const isCaptain = currentPlayer === ADMIN_ID;

  const myRlcsBets = (bets||[]).filter(b => b.bettorId === currentPlayer && b.isRlcs);

  useEffect(() => {
    let alive = true;
    storeGet("rlcs_matches").then(saved => {
      if (!alive || !saved?.matches?.length) return;
      setMatches(saved.matches.map(normalizeRlcsMatch));
      setLastSynced(saved.syncedAt || null);
    });
    return () => { alive = false; };
  }, []);

  const syncRealMatches = async () => {
    if (!isCaptain || syncingMatches) return;
    setSyncingMatches(true);
    setSyncError("");

    try {
      // IMPORTANT:
      // Your frontend calls YOUR backend here. Your PandaScore key should live in the backend, not inside App.jsx.
      // Backend should return either { matches:[...] } or just an array of matches.
      const res = await fetch("/api/rlcs/upcoming", { method:"GET" });
      if (!res.ok) throw new Error(`sync failed (${res.status})`);

      const json = await res.json();
      const rawMatches = Array.isArray(json) ? json : (json.matches || json.data || []);

      const normalized = rawMatches
        .map((m, i) => normalizeRlcsMatch(m, i))
        .filter(m => m.home !== "TBD" && m.away !== "TBD")
        .slice(0, 12);

      if (!normalized.length) throw new Error("no upcoming matches returned");

      const payload = { matches: normalized, syncedAt: new Date().toISOString(), source:"pandascore" };
      setMatches(normalized);
      setLastSynced(payload.syncedAt);
      await storeSet("rlcs_matches", payload);
    } catch (err) {
      setSyncError("couldn't sync real matches yet — add your backend route + PandaScore token");
    } finally {
      setSyncingMatches(false);
    }
  };

  const placeBet = async (match, side) => {
    if (myPoints < wager) return;
    const odds = side === "home" ? match.homeOdds : match.awayOdds;
    const dec = americanToDecimal(odds);
    const payout = Math.round(wager * dec);
    const team = side === "home" ? match.home : match.away;
    const bet = {
      id: Date.now().toString(),
      bettorId: currentPlayer,
      isRlcs: true,
      marketType: "match_winner",
      matchId: match.id,
      team,
      opponent: side === "home" ? match.away : match.home,
      home: match.home,
      away: match.away,
      league: match.league,
      date: match.date,
      beginAt: match.beginAt,
      wager,
      payout,
      odds,
      status: "open",
      placedAt: new Date().toISOString(),
      source: match.source || "manual",
    };
    const upd = { ...points, [currentPlayer]: myPoints - wager };
    setPoints(upd); await storeSet("points", upd);
    const updBets = [...(bets||[]), bet];
    setBets(updBets); await storeSet("bets", updBets);
    setPlaced(p => ({ ...p, [match.id]: side }));
  };

  return (
    <div>
      <div style={{fontSize:11,color:"#4A5066",marginBottom:14,lineHeight:1.5}}>
        bet on upcoming Rocket League matches. captain sync pulls real match cards, then captain settles winners manually.
      </div>

      <div style={{background:"linear-gradient(135deg,#180B22,#0B0E18)",border:"2px solid rgba(255,97,193,0.25)",borderRadius:20,padding:14,marginBottom:14,boxShadow:"0 14px 34px rgba(255,97,193,0.08)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:showLive?12:0}}>
          <div>
            <div style={{fontSize:11,color:"#FF61C1",fontWeight:900,letterSpacing:1}}>RLCS LIVE</div>
            <div style={{fontSize:12,color:"#8B92A8",marginTop:3}}>watch the Rocket League stream while you place bets</div>
          </div>
          {!showLive && (
            <button onClick={()=>setShowLive(true)} className="bb-pressable bb-glow-pink" style={{background:"#FF61C1",border:"none",borderRadius:14,padding:"10px 14px",fontSize:12,fontWeight:900,color:"#06070D",cursor:"pointer",flexShrink:0}}>
              ▶ play
            </button>
          )}
        </div>
        {showLive && (
          <div style={{position:"relative",paddingTop:"56.25%",borderRadius:16,overflow:"hidden",background:"#05060C",border:"1px solid rgba(255,255,255,0.08)"}}>
            <iframe
              src={`https://www.youtube.com/embed/${RLCS_LIVE_VIDEO_ID}?autoplay=1&controls=0&modestbranding=1&rel=0&playsinline=1`}
              title="RLCS Live"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: "none"
              }}
            />
          </div>
        )}
      </div>

      <div style={{background:"linear-gradient(135deg,#10192D,#0B0D17)",borderRadius:18,padding:16,marginBottom:14,border:"2px solid rgba(77,158,255,0.16)",boxShadow:"0 12px 28px rgba(0,0,0,0.20)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div>
            <div style={{fontSize:10,color:"#4D9EFF",fontWeight:900,letterSpacing:0.9}}>REAL MATCH SYNC</div>
            <div style={{fontSize:11,color:"#8B92A8",marginTop:4,lineHeight:1.45}}>
              {lastSynced ? `last synced ${fmtRelTime(lastSynced)}` : "using sample cards until captain syncs real matches"}
            </div>
          </div>
          {isCaptain ? (
            <button onClick={syncRealMatches} disabled={syncingMatches} className="bb-pressable"
              style={{background:syncingMatches?"rgba(77,158,255,0.16)":"#4D9EFF",border:"none",borderRadius:12,padding:"9px 12px",fontSize:11,fontWeight:900,color:syncingMatches?"#8B92A8":"#06070D",cursor:syncingMatches?"default":"pointer",flexShrink:0}}>
              {syncingMatches ? "syncing…" : "sync real"}
            </button>
          ) : (
            <div style={{fontSize:10,color:"#4A5066",fontWeight:800}}>captain only</div>
          )}
        </div>
        {syncError && <div style={{fontSize:10,color:"#FF5C8A",marginTop:10,lineHeight:1.4}}>{syncError}</div>}
      </div>

      <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,padding:16,marginBottom:14,border:"2px solid rgba(255,255,255,0.08)",boxShadow:"0 12px 28px rgba(0,0,0,0.20)"}}>
        <div style={{fontSize:10,color:"#4A5066",fontWeight:700,marginBottom:8}}>WAGER</div>
        <div style={{display:"flex",gap:8}}>
          {[10,25,50,100].map(amt=>(
            <button key={amt} onClick={()=>setWager(amt)} className="bb-pressable"
              style={{flex:1,background:wager===amt?"#B8FF4D":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"8px 0",fontSize:11,fontWeight:700,color:wager===amt?"#06070D":"#8B92A8",cursor:"pointer"}}>
              {amt}
            </button>
          ))}
        </div>
      </div>

      {matches.map(match => {
        const alreadyBet = placed[match.id] || myRlcsBets.find(b => b.matchId === match.id && b.marketType === "match_winner");
        const homeDec = americanToDecimal(match.homeOdds);
        const awayDec = americanToDecimal(match.awayOdds);
        return (
          <div key={match.id} style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,padding:14,marginBottom:10,border:`2px solid ${alreadyBet?"rgba(184,255,77,0.25)":"rgba(255,255,255,0.07)"}`,boxShadow:"0 10px 24px rgba(0,0,0,0.18)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,gap:10}}>
              <div>
                <div style={{fontSize:9,color:"#A78BFA",fontWeight:800,letterSpacing:0.8}}>{match.league}</div>
                {match.source==="sample" && <div style={{fontSize:9,color:"#FFD166",fontWeight:800,marginTop:3}}>sample · sync real matches</div>}
              </div>
              <div style={{fontSize:9,color:"#4A5066",textAlign:"right"}}>{match.date}</div>
            </div>
            {alreadyBet ? (
              <div style={{textAlign:"center",padding:"10px 0"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#7CFFB2",marginBottom:4}}>
                  ✓ bet placed — {typeof alreadyBet === "string"
                    ? (alreadyBet==="home"?match.home:match.away)
                    : alreadyBet.team}
                </div>
                <div style={{fontSize:10,color:"#4A5066"}}>to win {typeof alreadyBet==="string" ? Math.round(wager*(alreadyBet==="home"?homeDec:awayDec)) : alreadyBet.payout} pts</div>
              </div>
            ) : (
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>placeBet(match,"home")} disabled={myPoints<wager || match.home==="TBD"} className="bb-pressable"
                  style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 8px",cursor:myPoints>=wager?"pointer":"default",opacity:myPoints<wager?0.4:1,textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#E8ECF4",marginBottom:6}}>{match.home}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#B8FF4D"}}>{match.homeOdds}</div>
                  <div style={{fontSize:9,color:"#4A5066",marginTop:4}}>win {Math.round(wager*homeDec)} pts</div>
                </button>
                <div style={{display:"flex",alignItems:"center",fontSize:11,color:"#4A5066",fontWeight:700,padding:"0 4px"}}>VS</div>
                <button onClick={()=>placeBet(match,"away")} disabled={myPoints<wager || match.away==="TBD"} className="bb-pressable"
                  style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 8px",cursor:myPoints>=wager?"pointer":"default",opacity:myPoints<wager?0.4:1,textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#E8ECF4",marginBottom:6}}>{match.away}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#FF61C1"}}>{match.awayOdds}</div>
                  <div style={{fontSize:9,color:"#4A5066",marginTop:4}}>win {Math.round(wager*awayDec)} pts</div>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {myRlcsBets.length > 0 && (
        <div style={{marginTop:16}}>
          <div style={{fontSize:11,color:"#4A5066",fontWeight:700,letterSpacing:0.8,marginBottom:10}}>YOUR RLCS BETS</div>
          {myRlcsBets.map(b => (
            <div key={b.id} style={{background:"#11131F",borderRadius:12,padding:12,marginBottom:8,border:`1px solid ${b.status==="won"?"rgba(124,255,178,0.2)":b.status==="lost"?"rgba(255,92,138,0.1)":"rgba(255,209,102,0.15)"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#E8ECF4"}}>{b.team} <span style={{color:"#4A5066"}}>vs</span> {b.opponent}</div>
                  <div style={{fontSize:10,color:"#4A5066",marginTop:2}}>{b.league} · {b.date} · {b.odds}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,fontWeight:700,color:b.status==="won"?"#7CFFB2":b.status==="lost"?"#FF5C8A":"#FFD166"}}>
                    {b.status==="open"?"PENDING":b.status.toUpperCase()}
                  </div>
                  <div style={{fontSize:10,color:"#4A5066",marginTop:2}}>to win {b.payout} pts</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== Games Hub Tab =====================
const GAME_CARDS = [
  { id:"trivia",   emoji:"🧠", label:"RLCS Trivia",     desc:"5 questions · up to 3x your wager",       color:"#4D9EFF" },
  { id:"race",     emoji:"🏁", label:"Race Mode",        desc:"first to hit the objective wins bonus pts", color:"#B8FF4D" },
  { id:"boostgrab",emoji:"⚡", label:"Boost Grab",       desc:"tap pads, avoid bombs, cash out anytime",  color:"#FF8C42" },
  { id:"recap",    emoji:"📊", label:"Recap Trivia",     desc:"questions based on THIS week's real stats", color:"#FFD166" },
  { id:"rlcsbets", emoji:"🏆", label:"RLCS Bets",        desc:"bet on real pro matches with live odds",    color:"#FF61C1" },
  { id:"stocks",   emoji:"📈", label:"Stock Market",     desc:"invest pts in teammates before matches",    color:"#7CFFB2" },
];

function TeamLinkTab({ stats }) {
  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,letterSpacing:0.5,marginBottom:4}}>team link</div>
      <div style={{fontSize:12,color:"#8B92A8",lineHeight:1.45,marginBottom:16}}>synced team games grouped by day and game.</div>
      <TeamLinkGames stats={stats} />
    </div>
  );
}

function GamesTab({ stats, currentPlayer, points, setPoints, bets, setBets, activeRace, setActiveRace, raceStart, setRaceStart }) {
  const [active, setActive] = useState(null);
  const myPoints = points?.[currentPlayer] || 0;

  if (active === "trivia") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <RLCSTrivia currentPlayer={currentPlayer} points={points} setPoints={setPoints}/>
    </div>
  );
  if (active === "race") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <RaceModeTab stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} activeRace={activeRace} setActiveRace={setActiveRace} raceStart={raceStart} setRaceStart={setRaceStart}/>
    </div>
  );
  if (active === "boostgrab") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <BoostGrab currentPlayer={currentPlayer} points={points} setPoints={setPoints}/>
    </div>
  );
  if (active === "recap") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <WeeklyRecapTrivia stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints}/>
    </div>
  );
  if (active === "rlcsbets") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <RLCSBets currentPlayer={currentPlayer} points={points} setPoints={setPoints} bets={bets} setBets={setBets}/>
    </div>
  );
  if (active === "stocks") return (
    <div className="bb-tab-content" style={s.tabContent}>
      <button onClick={()=>setActive(null)} className="bb-pressable" style={backBtnStyle}>← back to games</button>
      <StockMarketTab stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} stocks={{}} setStocks={()=>{}}/>
    </div>
  );

  return (
    <div className="bb-tab-content" style={s.tabContent}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,letterSpacing:0.5,marginBottom:4}}>arcade</div>
      <div style={{fontSize:12,color:"#B8FF4D",marginBottom:20,fontWeight:700}}>
        balance: <span style={{color:"#B8FF4D",fontWeight:900}}>{myPoints} pts</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {GAME_CARDS.map(card => (
          <button key={card.id} onClick={()=>setActive(card.id)} className="bb-pressable"
            style={{background:"linear-gradient(135deg,#11131F,#0C0E18)",border:`1px solid ${card.color}33`,borderRadius:18,padding:"18px 14px",textAlign:"left",cursor:"pointer",display:"flex",flexDirection:"column",gap:0,minHeight:140}}>
            <div style={{fontSize:32,marginBottom:10}}>{card.emoji}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:card.color,marginBottom:6,lineHeight:1.1}}>{card.label}</div>
            <div style={{fontSize:11,color:"#4A5066",lineHeight:1.4,flex:1}}>{card.desc}</div>
            <div style={{fontSize:10,color:card.color,fontWeight:700,marginTop:10}}>play →</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const backBtnStyle = {
  background:"none",border:"none",color:"#A78BFA",fontSize:12.5,fontWeight:700,
  cursor:"pointer",padding:"0 0 16px",display:"block",letterSpacing:0.3,
};                  
      
                  
                  
                  
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
  const [myMode,setMyMode]=useState(null);
  const [pings,setPings]=useState([]);
  const [points,setPoints]=useState({});
const [parseCredits, setParseCredits] = useState({});
const [creditRequests, setCreditRequests] = useState([]);                      
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
const [coinFlips, setCoinFlips] = useState([]);
const [activeRace, setActiveRace] = useState(null);
const [raceStart, setRaceStart] = useState(null);
  const [bannerDismissed,setBannerDismissed]=useState(false);
  const [pushSub, setPushSub] = useState(null);
const [themeId, setThemeId] = useState("starfield");
const [lastSeen, setLastSeen] = useState({social:0, chat:0, training:0});
const [showAllGames, setShowAllGames] = useState(false);
const [showBracket, setShowBracket] = useState(false);
const [statsJumpDate, setStatsJumpDate] = useState(null);
const [stocks, setStocks] = useState({});
const [flowers, setFlowers] = useState([]);
const [timeLogs, setTimeLogs] = useState([]);
const [chemistry, setChemistry] = useState({});   
const [activityFeed, setActivityFeed] = useState([]);
const [pendingActivityToasts, setPendingActivityToasts] = useState([]);  
const [catchupQueue, setCatchupQueue] = useState([]);
const [catchupStopped, setCatchupStopped] = useState(false);                      
const [flipChallenges, setFlipChallenges] = useState([]);    
const [teamRoom, setTeamRoom] = useState(null); // { id, mode, createdBy, createdAt, games:[] }                      
const [teamSessions, setTeamSessions] = useState([]); // planned 3v3 sessions / RSVPs
const [chatOpen, setChatOpen] = useState(false);
const [showTopNotifs, setShowTopNotifs] = useState(false);
const [voiceJoinBanner, setVoiceJoinBanner] = useState(null);
const [autoJoinVoiceNonce, setAutoJoinVoiceNonce] = useState(null);
const [typingStatus, setTypingStatus] = useState({});
const theme = THEMES[themeId];
const lastActiveRef = useRef(Date.now());
const AUTO_LOCK_MS = 10 * 60 * 1000;
const toastDismissedAll = useRef(false);
const lastVoicePresenceRef = useRef(null);
const addToast = useCallback((text, icon = "🔔") => {
  if (toastDismissedAll.current) return;
  const id = Date.now().toString();
  setToasts(prev => [...prev, { id, text, icon }]);
  setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
}, []);              
const closeChatPanel = useCallback(() => {
  setChatOpen(false);
  const upd = { ...lastSeen, chat: messages.length };
  setLastSeen(upd);
  storeSet(`lastSeen:${currentPlayer}`, upd);
}, [lastSeen, messages.length, currentPlayer]);
const chatSwipe = useSwipeRightToClose(closeChatPanel);
const bracketSwipe = useSwipeRightToClose(() => setShowBracket(false));

useEffect(() => {
  if (!currentPlayer) return;
  let alive = true;

  const pollVoicePresence = async () => {
    const vp = await storeGet("voice_presence") || {};
    const cutoff = Date.now() - 45 * 1000;
    const cleaned = Object.fromEntries(
      Object.entries(vp).filter(([_, v]) => new Date(v.ts).getTime() > cutoff)
    );

    if (!alive) return;

    const previous = lastVoicePresenceRef.current;
    if (previous) {
      Object.entries(cleaned).forEach(([pid, v]) => {
        if (pid === currentPlayer) return;
        if (previous[pid]) return;
        const player = PLAYERS.find(p => p.id === pid);
        setVoiceJoinBanner({
          id: `${pid}_${v.ts || Date.now()}`,
          playerId: pid,
          name: player?.name || v.name || "someone",
          color: player?.color || "#B8FF4D",
          ts: v.ts || new Date().toISOString(),
        });
      });
    }

    lastVoicePresenceRef.current = cleaned;
  };

  pollVoicePresence();
  const timer = setInterval(pollVoicePresence, 1000);
  return () => { alive = false; clearInterval(timer); };
}, [currentPlayer]);

useEffect(() => {
  if (catchupStopped || catchupQueue.length === 0) return;
  const [next, ...rest] = catchupQueue;
 addToast(
  `${next.fromName} ${next.text}${next.message ? ` — "${next.message}"` : ""}`,
  next.type==="like" ? "❤️" : next.type==="comment" ? "💬" : next.type==="prop" ? "🎯" : "🔔"
);
  const timer = setTimeout(() => setCatchupQueue(rest), 1400);
  return () => clearTimeout(timer);
}, [catchupQueue, catchupStopped]);   
                      

useEffect(() => {
  if (pendingActivityToasts.length === 0) return;
  setCatchupQueue(pendingActivityToasts);
  setCatchupStopped(false);
  setPendingActivityToasts([]);
  (async () => {
    const af = await storeGet("activity_feed") || [];
    const marked = af.map(e => e.to === currentPlayer ? { ...e, seen: true } : e);
    await storeSet("activity_feed", marked);
    setActivityFeed(marked.filter(e => e.to === currentPlayer));
  })();
}, [pendingActivityToasts]);                      

  // ── Real-time: subscribe to all shared KV keys once logged in ──
  useEffect(() => {
    if (!currentPlayer) return;
const heartbeat = async () => {
      const fresh = await storeGet("presence") || {};
      const upd = { ...fresh, [currentPlayer]: new Date().toISOString() };
      setPresence(upd);
      await storeSet("presence", upd);
    };
heartbeat(); const updateActive = () => { lastActiveRef.current = Date.now(); };
window.addEventListener("focus", updateActive);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateActive();
});
document.addEventListener("touchstart", updateActive, { passive: true });
document.addEventListener("mousemove", updateActive, { passive: true });
    const hbInterval = setInterval(heartbeat, 30000);
    const unsub = subscribeKVMulti(RT_KEYS, ({ key, value }) => {
      if (key === "chat") {
  setMessages(prev => {
    const newMsgs = value.filter(m => m.playerId !== currentPlayer && !prev.find(p => p.id === m.id));
    newMsgs.forEach(m => {
      const sender = PLAYERS.find(pl => pl.id === m.playerId);
      addToast(`${sender?.name}: ${m.text}`, "💬");
    });
    return value;
  });
}
      if (key === "posts")          setPosts(Array.isArray(value) ? value : []);
      if (key === "completions")    setCompletions(value);
if (key === "time_logs") setTimeLogs(value);
if (key === "flip_challenges") setFlipChallenges(Array.isArray(value) ? value : []);
if (key === "stocks") setStocks(value);
if (key === "flowers") setFlowers(Array.isArray(value) ? value : []);
if (key === "chemistry") setChemistry(value || {});
if (key === "coin_flips") setCoinFlips(value);
if (key === "team_room") setTeamRoom(value?.closed ? null : value);
if (key === "team_sessions") setTeamSessions(Array.isArray(value) ? value : []);
if (key === "parse_credits") setParseCredits(value);
if (key === "credit_requests") setCreditRequests(Array.isArray(value) ? value : []);
if (key === "active_race") {
  if (value?.objectiveId) {
    setActiveRace(value.objectiveId);
    setRaceStart(value.startedAt);
    if (value.startedBy !== currentPlayer) {
      const starter = PLAYERS.find(p => p.id === value.startedBy);
      const obj = RACE_OBJECTIVES.find(o => o.id === value.objectiveId);
      addToast(`${starter?.name} started a race — ${obj?.label}! Go to Race tab.`, obj?.emoji || "🏁");
    }
  } else {
    setActiveRace(null);
    setRaceStart(null);
    if (value?.cancelled && value?.cancelledBy !== currentPlayer) {
      const canceller = PLAYERS.find(p => p.id === value.cancelledBy);
      addToast(`${canceller?.name} cancelled the race.`, "❌");
    }
  }
}
      if (key === "training")       setTrainingData(value);
      if (key === "schedule")       setSchedule(value);
      if (key === "comments")       setComments(value);
      if (key === "stream_profiles") setStreamProfiles(value);
       if (key === "stats") setStats(Array.isArray(value) ? value : []);
      if (key === "presence")        setPresence(value);
      if (key === "pings")           setPings(Array.isArray(value) ? value : []);
      if (key === "points")          setPoints(value);
if (key === "bets")            setBets(Array.isArray(value) ? value : []);
if (key === "pass_xp")      setPassXP(value);
if (key === "pass_premium") setPassPremium(value);
if (key === "pass_claimed") setPassClaimed(value);
if (key === "pass_tokens")  setPassTokens(value);
if (key === "pass_active_boosts") setPassActiveBoosts(value);
if (key === "typing") setTypingStatus(value || {});
if (key === "parse_credits") setParseCredits(value || {});
if (key === "credit_requests") setCreditRequests(Array.isArray(value) ? value : []);
if (key === "activity_feed") {
  const myFeed = (Array.isArray(value)?value:[]).filter(e=>e.to===currentPlayer);
  const prev = activityFeed || [];
  const newEntries = myFeed.filter(e=>!prev.find(p=>p.id===e.id)&&!e.seen);
  newEntries.forEach((e,i)=>{
    setTimeout(()=>addToast(`${e.fromName} ${e.text}`,e.type==="like"?"❤️":e.type==="comment"?"💬":"🔔"),i*800);
  });
  setActivityFeed(myFeed);
}
});
return () => {
    clearInterval(hbInterval);
    unsub?.();
    document.removeEventListener("touchstart", updateActive);
    document.removeEventListener("mousemove", updateActive);
    window.removeEventListener("focus", updateActive);
  };
  }, [currentPlayer]);

  useEffect(() => {
  if (!currentPlayer) return;
  const checkLock = async () => {
    if (document.hidden) return;
    const timeSinceActive = Date.now() - lastActiveRef.current;
   if (timeSinceActive > AUTO_LOCK_MS) {
  const fresh = await storeGet("presence") || {};
  const upd = { ...fresh, [currentPlayer + "_mode"]: null };
  delete upd[currentPlayer];
  await storeSet("presence", upd);
  setPresence(upd);

  setMyMode(null);
  setCurrentPlayer(null);
  setAuthStage("select");
  setSelectedPlayerId(null);
  setTab("home");
} else {
      lastActiveRef.current = Date.now();
    }
  };
  document.addEventListener("visibilitychange", checkLock);
  return () => document.removeEventListener("visibilitychange", checkLock);
}, [currentPlayer]);


  const selectName=async(pid)=>{ setSelectedPlayerId(pid); const auth=await storeGet(`auth:${pid}`); setAuthStage(auth?"enter":"create"); };

const loadSharedData = async (pid) => {
  setLoading(true);

  const [sched,training,comp,chat,cmts,pst,strm,sts,prs,pngs,tr,tsess,pts,bts,pxp,ppm,pcl,ptk,pab,tlogs,stks,cf,ar,chem,fc,af,pc,cr] = await Promise.all([
storeGet("schedule"),
storeGet("training"),
storeGet("completions"),
storeGet("chat"),
storeGet("comments"),
storeGet("posts"),
storeGet("stream_profiles"),
storeGet("stats"),
storeGet("presence"),
storeGet("pings"),
storeGet("team_room"),
storeGet("team_sessions"),
storeGet("points"),
storeGet("bets"),
storeGet("pass_xp"),
storeGet("pass_premium"),
storeGet("pass_claimed"),
storeGet("pass_tokens"),
storeGet("pass_active_boosts"),
storeGet("time_logs"),
storeGet("stocks"),
storeGet("coin_flips"),
storeGet("active_race"),
storeGet("chemistry"),
storeGet("flip_challenges"),
storeGet("activity_feed"),
storeGet("parse_credits"),
storeGet("credit_requests"),
  ]);

  if (sched) setSchedule(sched);
  if (training) setTrainingData(training);
  if (comp) setCompletions(comp);
  if (chat) setMessages(Array.isArray(chat) ? chat : []);
  if (cmts) setComments(cmts);
  if (pst) setPosts(Array.isArray(pst) ? pst : []);
  if (strm) setStreamProfiles(strm);
  if (sts) setStats(Array.isArray(sts) ? sts : []);
  if (prs) { setPresence(prs); setMyMode(prs[pid+"_mode"] || null); }
  if (pngs) setPings(Array.isArray(pngs) ? pngs : []);
setTeamRoom(tr && !tr.closed ? tr : null);
  if (tsess) setTeamSessions(Array.isArray(tsess) ? tsess : []);
  if (pts) setPoints(pts);
  if (bts) setBets(Array.isArray(bts) ? bts : []);
  if (pxp) setPassXP(pxp);
  if (ppm) setPassPremium(ppm);
  if (pcl) setPassClaimed(pcl);
  if (ptk) setPassTokens(ptk);
  if (pab) setPassActiveBoosts(pab);
  if (tlogs) setTimeLogs(Array.isArray(tlogs) ? tlogs : []);
  if (stks) setStocks(stks);
  if (cf) setCoinFlips(Array.isArray(cf) ? cf : []);
  if (ar && ar.objectiveId) { setActiveRace(ar.objectiveId); setRaceStart(ar.startedAt); }
  if (chem) setChemistry(chem);
  if (fc) setFlipChallenges(Array.isArray(fc) ? fc : []);
  if (tr && !tr.closed) setTeamRoom(tr);

  if (af) {
    const myFeed = (Array.isArray(af) ? af : []).filter(e => e.to === pid);
    setActivityFeed(myFeed);

const lastLoginAt = await storeGet(`lastLoginAt:${pid}`);
const newSince = lastLoginAt ? new Date(lastLoginAt).getTime() : Date.now();
await storeSet(`lastLoginAt:${pid}`, new Date().toISOString());

const unseenNew = myFeed.filter(e =>
      !e.seen && new Date(e.ts).getTime() > newSince
    );

    const missedChats = (Array.isArray(chat) ? chat : [])
      .filter(m => m.playerId !== pid && new Date(m.ts).getTime() > newSince)
      .slice(-3)
      .map(m => ({
        id: m.id,
        fromName: PLAYERS.find(p => p.id === m.playerId)?.name || "teammate",
        text: `said: "${m.text.slice(0, 40)}${m.text.length > 40 ? "…" : ""}"`,
        type: "chat",
        ts: m.ts,
      }));

    const myPostIds = new Set((Array.isArray(pst) ? pst : [])
      .filter(p => p.playerId === pid).map(p => p.id));
    const missedPostActivity = [];
    (Array.isArray(pst) ? pst : []).forEach(post => {
      if (!myPostIds.has(post.id)) return;
      (post.comments || [])
        .filter(c => c.playerId !== pid && new Date(c.ts).getTime() > newSince)
        .forEach(c => {
          const name = PLAYERS.find(p => p.id === c.playerId)?.name || "someone";
          missedPostActivity.push({ id: c.id, fromName: name, text: "commented on your post", type: "comment", ts: c.ts });
        });
    });

    const allCatchup = [...unseenNew, ...missedChats, ...missedPostActivity]
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

if (allCatchup.length > 0) {
  setPendingActivityToasts(allCatchup);
  // immediately mark all as seen so they don't repeat
  const allIds = new Set(allCatchup.map(e => e.id).filter(Boolean));
  const markedAll = (Array.isArray(af) ? af : []).map(e =>
    allIds.has(e.id) ? { ...e, seen: true } : e
  );
  await storeSet("activity_feed", markedAll);
}

    if (unseenNew.length > 0) {
      const seenIds = new Set(unseenNew.map(e => e.id));
      const markedSeen = af.map(e => seenIds.has(e.id) ? { ...e, seen: true } : e);
      await storeSet("activity_feed", markedSeen);
    }
  }


if (pc) setParseCredits(pc);
if (cr) setCreditRequests(Array.isArray(cr) ? cr : []);

const profiles = {};
  for (const p of PLAYERS) {
    const profile = await getMMR(p.id);
    if (profile) {
      if (!profile.ranks?.[0]?.prevMmr) {
        const stamped = { ...profile, ranks: profile.ranks.map(r => ({ ...r, prevMmr: r.mmr, prevRank: r.rank })) };
        await setMMR(p.id, stamped);
        profiles[p.id] = stamped;
      } else {
        profiles[p.id] = profile;
      }
    }
  }
  setMmrProfiles(profiles);
  setCurrentPlayer(pid);

  const savedLastSeen = await storeGet(`lastSeen:${pid}`);
  if (savedLastSeen) setLastSeen(savedLastSeen);
  else setLastSeen({ social: 0, chat: 0, training: 0 });

  if (!profiles[pid]) setAuthStage("tracker");
  else setAuthStage("app");

  setLoading(false);
};


const useParseCredit = async (playerId) => {
  const current = parseCredits?.[playerId] ?? PARSE_CREDITS_DEFAULT;
  if (current <= 0) {
    addToast("out of parse credits — request more in the squad tab", "❌");
    return false;
  }
  const upd = { ...parseCredits, [playerId]: current - 1 };
  setParseCredits(upd);
  await storeSet("parse_credits", upd);
  return true;
};


const handleResync = async (pid) => {
  const ok = await useParseCredit(pid);
  if (!ok) return;
  setResyncingId(pid);
  setResyncOverlay(true);
  setPendingResyncPlayer(pid);
  await new Promise(r => setTimeout(r, 100)); // let overlay render
  const existing = mmrProfiles[pid];
  if (existing) {
    try {
      const res = await fetch(
        `https://api.parse.bot/scraper/d0dcf8e8-3a72-4b21-bffb-8fa735257835/get_player_sessions?platform=${existing.platform}&username=${existing.handle}`,
        { headers: { "X-API-Key": "pmx_8a6e026a59120911628f4faf9ff66847" } }
      );
      const json = await res.json();
      const segments = json?.data?.segments || [];
      const playlistIds = { "Ranked Duel 1v1": 10, "Ranked Doubles 2v2": 11, "Ranked Standard 3v3": 13 };
      const newRanks = existing.ranks.map(r => {
const seg = segments.find(s => s.type === "playlist" && s.metadata?.name === r.playlist);
const newMmr = seg?.stats?.rating?.value || r.mmr;

console.log("RESYNC SEGMENT:", r.playlist, seg?.stats);

const newRankName =
  seg?.stats?.tier?.metadata?.name ||
  r.rank ||
  "Unranked";

return {
  ...r,
  prevMmr: r.mmr,
  prevRank: r.rank,
  mmr: newMmr,
  rank: newRankName
};
      });
      const updated = { ...existing, ranks: newRanks, lastSynced: new Date().toISOString(), source: existing.source === "admin" ? "admin" : "synced" };
      setMmrProfiles(prev => ({ ...prev, [pid]: updated }));
      await setMMR(pid, updated);
      addToast?.("ranks updated!", "✅");
    } catch(e) {
      addToast?.("sync failed — check connection", "❌");
    }
  }
  setResyncOverlay(false);
  setResyncingId(null);
};

  const incompleteDays=(()=>{
    if (!currentPlayer) return [];
    const today=todayAtMidnight(); const out=[];
    Object.keys(trainingData).forEach((k)=>{ const [dk,pid]=k.split("__"); if(pid!==currentPlayer)return; const date=new Date(dk+"T00:00:00"); if(date>=today)return; const comp=completions[tKey(dk,currentPlayer)]; if(!comp) out.push({key:dk,date,training:trainingData[k]}); });
    return out.sort((a,b)=>a.date-b.date);
  })();

const touchStartY = useRef(0);
  const scrollContainerRef = useRef(null);
const scrollToTop = () => { scrollContainerRef.current?.scrollTo(0, 0); };
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
if (loading) return <><GlobalStyles/><div style={{...s.screen,alignItems:"center",justifyContent:"center",animation:"fadeSlideUp .5s cubic-bezier(.2,.8,.2,1)"}}><div style={{color:"#4A5066",fontSize:13,letterSpacing:1}}>loading team data…</div></div></>;
  if (authStage==="tracker") return <><GlobalStyles/><TrackerSetup player={selectedPlayer} onUseCredit={async()=>{ const current = parseCredits?.[selectedPlayerId] ?? PARSE_CREDITS_DEFAULT; if(current<=0) return false; const upd={...parseCredits,[selectedPlayerId]:current-1}; setParseCredits(upd); await storeSet("parse_credits",upd); return true; }} onComplete={async()=>{ const profile=await getMMR(selectedPlayerId); setMmrProfiles((prev)=>({...prev,[selectedPlayerId]:profile})); setAuthStage("app"); }}/></>;
  const playerObj=PLAYERS.find((p)=>p.id===currentPlayer);
  const isAdmin=currentPlayer===ADMIN_ID;
const TABS=[
    {id:"home",     icon:Home,       label:"home"},
    {id:"room",     icon:MessageCircle, label:"room"},
    {id:"training", icon:Dumbbell,   label:"training"},
    {id:"social",   icon:ImageIcon,  label:"social"},
    {id:"stats",    icon:BarChart2,  label:"stats"},
    {id:"presence", icon:Circle,     label:"squad"},
    {id:"boost",    icon:Dice5,      label:"boost"},
    {id:"coinflip", icon:Dice5,      label:"flip"},
    {id:"games",    icon:Dice5,      label:"games"},
    {id:"garage",   icon:Trophy,     label:"pass"},
    {id:"chemistry",icon:Heart,      label:"chem"},
    ...(isAdmin?[{id:"admin",icon:Shield,label:"admin"}]:[]),
];
  const badges = {
    social: Math.max(0, posts.length - lastSeen.social),
    chat: Math.max(0, messages.length - lastSeen.chat),
    training: Math.max(0, Object.keys(completions).filter(k => k.endsWith(`__${currentPlayer}`) && completions[k].status==="pending").length - lastSeen.training),
  };
  const topActivityNotifs = (activityFeed||[]).filter(e => e.to === currentPlayer).map(e => ({
    id: e.id,
    ts: e.ts,
    text: `${e.fromName} ${e.text}`,
    icon: e.type==="like" ? "❤️" : e.type==="comment" ? "💬" : e.type==="comment_heart" ? "🩷" : "🔔",
  }));
  const topPingNotifs = (pings||[]).filter(p => p.to === currentPlayer).map(p => ({
    id: p.id,
    ts: p.ts,
    text: p.type==="flower"
      ? `${PLAYERS.find(pl=>pl.id===p.from)?.name || "someone"} sent you ${p.emoji || "🌸"} (+${p.xp || 0} xp)`
      : p.type==="session"
        ? `${PLAYERS.find(pl=>pl.id===p.from)?.name || "someone"} started a ${p.mode || "3v3"} session ${p.minutesUntil ? `in ${p.minutesUntil} min` : "soon"}`
        : p.type==="coinflip"
          ? `${PLAYERS.find(pl=>pl.id===p.from)?.name || "someone"} challenged you to a coin flip`
          : `${PLAYERS.find(pl=>pl.id===p.from)?.name || "someone"} wants to run 2s`,
    icon: p.type==="flower" ? "🌸" : p.type==="session" ? "⏱️" : p.type==="coinflip" ? "🪙" : "🎮",
  }));
  const topTrainingNotifs = Object.entries(completions||{})
    .filter(([k,v]) => v?.status==="approved" && k.endsWith(`__${currentPlayer}`))
    .map(([k,v]) => ({ id:k, ts:v.reviewedAt||v.submittedAt||new Date().toISOString(), text:"training approved — +15 pts", icon:"✅" }));
  const clearedNotifIds = points?.[currentPlayer + "_clearedNotifs"] || [];
  const topNotifsRaw = [...topActivityNotifs, ...topPingNotifs, ...topTrainingNotifs]
    .sort((a,b) => new Date(b.ts) - new Date(a.ts));
  const topNotifs = topNotifsRaw
    .filter(n => !clearedNotifIds.includes(n.id))
    .slice(0, 40);
  const eq = points?.[currentPlayer+"_equipped"] || {};
  const own = points?.[currentPlayer+"_owned"] || [];
  const bgId = own.find(id => eq[id] && ["bg_carbon","bg_spring","bg_aurora","bg_midnight","bg_matrix","bg_whiteout","bg_pinkboost","bg_morse","bg_turf","bg_moss","bg_goalnet","bg_custom"].includes(id));
  const customUrl = points?.[currentPlayer+"_customBg"];
  const hasTextKitEquipped = own.some(id => eq[id] && id.startsWith("pass_premium_") && getPassRewardForOwnedId(id)?.type === "text_color");
  const textColors = hasTextKitEquipped ? (points?.[currentPlayer+"_textColors"] || {}) : {};
  const bgStyle = bgId==="bg_carbon" ? {backgroundImage:"repeating-linear-gradient(45deg,#0e0e0e 0px,#0e0e0e 3px,#1a1a1a 3px,#1a1a1a 6px)"}
    : bgId==="bg_spring"   ? {backgroundImage:"linear-gradient(135deg,#1a0a1a,#0a1a12,#0a1220)"}
    : bgId==="bg_aurora"   ? {backgroundImage:"linear-gradient(135deg,#040d14,#012a1a,#040818)"}
    : bgId==="bg_midnight" ? {backgroundImage:"linear-gradient(135deg,#04050f,#080830,#04050f)"}
    : bgId==="bg_matrix" ? {backgroundImage:"repeating-linear-gradient(90deg,rgba(184,255,77,.08) 0 2px,transparent 2px 12px),radial-gradient(circle at 30% 20%,rgba(184,255,77,.18),transparent 30%),linear-gradient(135deg,#020806,#06120B)"}
    : bgId==="bg_whiteout" ? {backgroundImage:"linear-gradient(135deg,#FAFAF5,#FFFFFF,#F0F0EA)", color:"#11131F"}
    : bgId==="bg_pinkboost" ? {backgroundImage:"linear-gradient(135deg,#220817,#4A123E,#10113A)"}
    : bgId==="bg_morse" ? {backgroundImage:"repeating-linear-gradient(90deg,rgba(184,255,77,.14) 0 8px,transparent 8px 14px,rgba(184,255,77,.08) 14px 17px,transparent 17px 28px),linear-gradient(135deg,#020806,#03120B)"}
    : bgId==="bg_turf" ? {backgroundImage:"repeating-linear-gradient(115deg,#15360F 0 3px,#1F4B17 3px 6px,#10280C 6px 9px)"}
    : bgId==="bg_moss" ? {backgroundImage:"radial-gradient(circle at 20% 20%,#315D25 0 10%,transparent 11%),radial-gradient(circle at 80% 30%,#1C3A18 0 12%,transparent 13%),linear-gradient(135deg,#081307,#183115)"}
    : bgId==="bg_goalnet" ? {backgroundImage:"linear-gradient(90deg,rgba(255,255,255,.10) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.10) 1px,transparent 1px),linear-gradient(135deg,#05070D,#101625)",backgroundSize:"34px 34px,34px 34px,cover"}
    : bgId==="bg_custom" && customUrl ? {backgroundImage:`url(${customUrl})`,backgroundSize:"cover",backgroundPosition:"center"}
    : {background:theme.bg};

  return (
    <div style={{...s.appShell, ...bgStyle, color:textColors.main || theme.text, "--bb-main-text":textColors.main || theme.text, "--bb-muted-text":textColors.muted || "#8B92A8", "--bb-accent-text":textColors.accent || "#B8FF4D", animation:"fadeSlideUp .5s cubic-bezier(.2,.8,.2,1)"}}>
      <GlobalStyles/>
      {(points?.[currentPlayer+"_showStars"] !== false) && <StarfieldBg/>}

{toasts.length > 0 && (
  <div style={{position:"fixed",top:"max(60px,env(safe-area-inset-top))",left:"50%",transform:"translateX(-50%)",zIndex:999,width:"calc(100% - 32px)",maxWidth:440,pointerEvents:"auto"}}>
    <SwipeToast
      key={toasts[0].id}
      toast={toasts[0]}
      onDismiss={()=>setToasts(prev=>prev.slice(1))}
      onDismissAll={()=>{
        setToasts([]);
        setCatchupQueue([]);
        setCatchupStopped(true);
        toastDismissedAll.current = true;
        setTimeout(()=>{ toastDismissedAll.current = false; }, 30000);
      }}
    />
  </div>
)}
{voiceJoinBanner && (
  <div style={{position:"fixed",top:"max(60px,env(safe-area-inset-top))",left:"50%",transform:"translateX(-50%)",zIndex:1000,width:"calc(100% - 32px)",maxWidth:440,pointerEvents:"auto",animation:"dropDown .22s cubic-bezier(.2,.8,.2,1)"}}>
    <div style={{background:"linear-gradient(135deg,#11131F,#0B0D17)",border:`1px solid ${voiceJoinBanner.color}55`,borderRadius:18,padding:"13px 14px",boxShadow:"0 16px 44px rgba(0,0,0,0.42)",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:34,height:34,borderRadius:12,background:`${voiceJoinBanner.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🎙️</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:900,color:"#E8ECF4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{voiceJoinBanner.name} joined voice room</div>
        <div style={{fontSize:10.5,color:"#8B92A8",marginTop:2}}>tap join now to enter the room</div>
      </div>
      <button onClick={()=>{ setTab("room"); setAutoJoinVoiceNonce(Date.now()); setVoiceJoinBanner(null); }} className="bb-pressable bb-glow-lime" style={{background:"#B8FF4D",border:"none",borderRadius:11,padding:"9px 11px",fontSize:11,fontWeight:900,color:"#06070D",cursor:"pointer",flexShrink:0}}>
        join now
      </button>
      <button onClick={()=>setVoiceJoinBanner(null)} className="bb-pressable" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,width:30,height:30,color:"#8B92A8",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
        <X size={15}/>
      </button>
    </div>
  </div>
)}
      {resyncOverlay&&<SyncOverlay onDone={finishResync} label="syncing rocket league data"/>}
      {commentDay&&<CommentsModal dayKey={commentDay} comments={comments} setComments={setComments} currentPlayer={currentPlayer} onClose={()=>setCommentDay(null)}/>}
 <div style={s.topBar}>
  <div style={s.topBarTitle}>
    <div style={{display:"flex",alignItems:"center",gap:7}}>
      {isAdmin&&<Shield size={13} color="#FF5C8A"/>}
      <div style={{...s.youDot,background:playerObj.color,boxShadow:`0 0 8px ${playerObj.color}99`}}/>
      <span style={s.youName}>{playerObj.name}</span>
      <button onClick={()=>setShowTopNotifs(true)} className="bb-pressable" style={{...s.logoutBtn,position:"relative",marginLeft:2}}><Bell size={14}/></button>
    </div>
  </div>
<div style={s.topBarRight}>
  <button onClick={async()=>{ const upd={...points,[currentPlayer+"_showStars"]: points?.[currentPlayer+"_showStars"] === false}; setPoints(upd); await storeSet("points",upd); }} className="bb-pressable" style={s.logoutBtn}>{points?.[currentPlayer+"_showStars"] === false ? "☀️" : "🌙"}</button>
  <button onClick={()=>setChatOpen(true)} className="bb-pressable" style={{...s.logoutBtn,position:"relative"}}>
    <MessageCircle size={16}/>
    {Math.max(0, messages.length - lastSeen.chat) > 0 && (
      <div style={{position:"absolute",top:-3,right:-4,background:"#FF5C8A",borderRadius:99,minWidth:13,height:13,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",padding:"0 3px"}}>
        {Math.max(0, messages.length - lastSeen.chat)}
      </div>
    )}
  </button>
<button
  onClick={async () => {
    const fresh = await storeGet("presence") || {};
    const upd = { ...fresh, [currentPlayer + "_mode"]: null };
    delete upd[currentPlayer];

    await storeSet("presence", upd);
    setPresence(upd);
    setMyMode(null);

    setCurrentPlayer(null);
    setAuthStage("select");
    setSelectedPlayerId(null);
    setTab("home");
    setBannerDismissed(false);
  }}
  className="bb-pressable"
  style={s.logoutBtn}
>
  <LogOut size={15}/>
</button>
</div>
</div>
      {showTopNotifs && (
        <div style={{position:"fixed",inset:0,zIndex:950,background:"rgba(4,8,24,0.88)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"74px 18px 18px",animation:"chatFadeIn .18s ease"}} onClick={()=>setShowTopNotifs(false)}>
          <div onClick={(e)=>e.stopPropagation()} style={{width:"100%",maxWidth:420,maxHeight:"78vh",overflowY:"auto",background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(167,139,250,0.28)",borderRadius:22,padding:16,boxShadow:"0 24px 70px rgba(0,0,0,0.45)",animation:"dropDown .24s cubic-bezier(.2,.8,.2,1)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div>
                <div style={{fontSize:11,color:"#A78BFA",fontWeight:900,letterSpacing:1}}>NOTIFICATIONS</div>
                <div style={{fontSize:11,color:"#4A5066",marginTop:2}}>{topNotifs.length ? `${topNotifs.length} recent update${topNotifs.length!==1?"s":""}` : "nothing new yet"}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {topNotifs.length > 0 && (
                  <button onClick={async()=>{
                    const ids = topNotifsRaw.map(n => n.id);
                    const updPoints = { ...points, [currentPlayer + "_clearedNotifs"]: [...new Set([...(points?.[currentPlayer + "_clearedNotifs"] || []), ...ids])].slice(-300) };
                    setPoints(updPoints);
                    await storeSet("points", updPoints);

                    const freshPings = (await storeGet("pings") || []).filter(p => p.to !== currentPlayer);
                    setPings(freshPings);
                    await storeSet("pings", freshPings);

                    const freshActivity = (await storeGet("activity_feed") || []).filter(e => e.to !== currentPlayer);
                    setActivityFeed(freshActivity);
                    await storeSet("activity_feed", freshActivity);
                  }} className="bb-pressable" style={{background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.25)",borderRadius:10,padding:"7px 10px",fontSize:10,fontWeight:900,color:"#FF5C8A",cursor:"pointer"}}>
                    clear all
                  </button>
                )}
                <button onClick={()=>setShowTopNotifs(false)} className="bb-pressable" style={s.modalClose}><X size={18}/></button>
              </div>
            </div>
            {topNotifs.length===0 ? (
              <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:14,color:"#8B92A8",fontSize:13}}>No notifications yet.</div>
            ) : topNotifs.map(n => (
              <div key={n.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"11px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <div style={{fontSize:18,width:24,textAlign:"center",flexShrink:0}}>{n.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:"#E8ECF4",lineHeight:1.35}}>{n.text}</div>
                  <div style={{fontSize:10,color:"#4A5066",marginTop:3}}>{fmtRelTime(n.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!bannerDismissed&&<ReminderBanner incompleteDays={incompleteDays} onJump={(key)=>{ setTab("training"); setJumpKey(key); setBannerDismissed(true); }} onDismiss={()=>setBannerDismissed(true)}/>}
      <div ref={scrollContainerRef} style={{...s.tabBody, position:"relative", zIndex:1}} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
{tab==="home"&&<HomeTab key={tab} schedule={schedule} mmrProfiles={mmrProfiles} currentPlayer={currentPlayer} points={points} setPoints={setPoints} onResync={handleResync} resyncingId={resyncingId} trainingData={trainingData} completions={completions} onGotoTraining={(dayKey)=>{ if(dayKey) setJumpKey(dayKey); setTab("training"); }} stats={stats} setCompletions={setCompletions} onGotoStats={()=>setTab("stats")} statsJumpDate={statsJumpDate} setStatsJumpDate={setStatsJumpDate} passXP={passXP} setPassXP={setPassXP} timeLogs={timeLogs} setTimeLogs={setTimeLogs} onOpenBracket={()=>setShowBracket(true)}/>}
        {tab==="training"&&<TrainingTab key={tab} trainingData={trainingData} completions={completions} setCompletions={setCompletions} currentPlayer={currentPlayer} onOpenComments={setCommentDay} jumpKey={jumpKey} onJumpHandled={()=>setJumpKey(null)}/>}
      {tab==="social"&&<SocialTab key={tab} posts={posts} setPosts={setPosts} currentPlayer={currentPlayer} addToast={addToast} bets={bets} setBets={setBets} points={points} setPoints={setPoints} stats={stats}/>}
        {tab==="stream"&&<StreamTab key={tab} streamProfiles={streamProfiles} setStreamProfiles={setStreamProfiles} currentPlayer={currentPlayer}/>}
          
{tab==="room"&&(
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",height:"100%",padding:"20px",overflowY:"auto"}}>
    <div style={{width:"100%",maxWidth:480}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,letterSpacing:0.5,marginBottom:4,textAlign:"center"}}>voice room</div>
      <VoiceRoom currentPlayer={currentPlayer} addToast={addToast} points={points} autoJoinNonce={autoJoinVoiceNonce}/>
      <TeamSessionPlanner currentPlayer={currentPlayer} teamSessions={teamSessions} setTeamSessions={setTeamSessions} pings={pings} setPings={setPings} addToast={addToast}/>
      <RoomMusicPlayer currentPlayer={currentPlayer} addToast={addToast}/>
    </div>
  </div>
)}    
          
{tab==="stats"&&<StatsTab key={tab} stats={stats} setStats={setStats} currentPlayer={currentPlayer} passXP={passXP} setPassXP={setPassXP} jumpDate={statsJumpDate} onJumpHandled={()=>setStatsJumpDate(null)} schedule={schedule} setSchedule={setSchedule} teamRoom={teamRoom} setTeamRoom={setTeamRoom} mmrProfiles={mmrProfiles} setMmrProfiles={setMmrProfiles} addToast={addToast} useParseCredit={useParseCredit}/>}
 {tab==="boost"&&<BoostTab key={tab} stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} bets={bets} setBets={setBets}/>} 
{tab==="coinflip"&&<CoinFlipTab key={tab} currentPlayer={currentPlayer} points={points} setPoints={setPoints} coinFlips={coinFlips} setCoinFlips={setCoinFlips} flipChallenges={flipChallenges} setFlipChallenges={setFlipChallenges} pings={pings} setPings={setPings} addToast={addToast}/>}

{tab==="stocks"&&<StockMarketTab key={tab} stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} stocks={stocks} setStocks={setStocks}/>}
{tab==="presence"&&<PresenceTab key={tab} presence={presence} setPresence={setPresence} pings={pings} setPings={setPings} currentPlayer={currentPlayer} points={points} setPoints={setPoints} completions={completions} stats={stats} passXP={passXP} setPassXP={setPassXP} passPremium={passPremium} setPassPremium={setPassPremium} passTokens={passTokens} setPassTokens={setPassTokens} setTab={setTab} flowers={flowers} setFlowers={setFlowers} addToast={addToast} activityFeed={activityFeed} setActivityFeed={setActivityFeed} parseCredits={parseCredits} creditRequests={creditRequests} setCreditRequests={setCreditRequests}/>}
{tab==="garage"&&<GarageTab key={tab} currentPlayer={currentPlayer} points={points} setPoints={setPoints} passXP={passXP} passPremium={passPremium} passTokens={passTokens} setPassTokens={setPassTokens} passClaimed={passClaimed} setPassClaimed={setPassClaimed} passActiveBoosts={passActiveBoosts}/>}
{tab==="chemistry"&&<TeamChemistryTab key={tab} stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} chemistry={chemistry} setChemistry={setChemistry}/>}
{tab==="games"&&<GamesTab key={tab} stats={stats} currentPlayer={currentPlayer} points={points} setPoints={setPoints} bets={bets} setBets={setBets} activeRace={activeRace} setActiveRace={setActiveRace} raceStart={raceStart} setRaceStart={setRaceStart}/>}
 {tab==="admin"&&isAdmin&&<AdminTab key={tab} trainingData={trainingData} setTrainingData={setTrainingData} mmrProfiles={mmrProfiles} setMmrProfiles={setMmrProfiles} addToast={addToast} completions={completions} setCompletions={setCompletions} passXP={passXP} setPassXP={setPassXP} parseCredits={parseCredits} setParseCredits={setParseCredits} creditRequests={creditRequests} setCreditRequests={setCreditRequests}/>}
      </div>
      {showBracket && (
        <div {...bracketSwipe.swipeHandlers} style={{position:"fixed",inset:0,zIndex:80,background:"linear-gradient(180deg,#06070D,#0A0C16)",display:"flex",flexDirection:"column",animation:"chatPanelIn .22s cubic-bezier(.2,.8,.2,1)",...bracketSwipe.swipeStyle}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",paddingTop:"max(14px, env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.08)",flexShrink:0}}>
            <button onClick={()=>setShowBracket(false)} className="bb-pressable" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,color:"#E8ECF4",padding:"8px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontWeight:700}}>
              <ChevronLeft size={17}/> back
            </button>
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,letterSpacing:.5}}>bracket</div>
            </div>
          </div>
          <div style={{flex:1,minHeight:0,overflowY:"auto",paddingBottom:"max(24px, env(safe-area-inset-bottom))"}}>
            <BracketTab schedule={schedule} setSchedule={setSchedule} currentPlayer={currentPlayer}/>
          </div>
        </div>
      )}
      {chatOpen && (
    <div {...chatSwipe.swipeHandlers} style={{position:"fixed",inset:0,zIndex:1200,background:"linear-gradient(180deg,#06070D,#0A0C16)",display:"flex",flexDirection:"column",animation:"chatPanelUp .38s cubic-bezier(.16,1,.3,1)",paddingBottom:0,...chatSwipe.swipeStyle}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",paddingTop:"max(14px, env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
              <button onClick={closeChatPanel} className="bb-pressable" style={{background:"none",border:"none",color:"#8B92A8",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                <ChevronLeft size={18}/>
              </button>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600}}>team chat</div>
            </div>
           <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column"}}>
<ChatTab messages={messages} setMessages={setMessages} currentPlayer={currentPlayer} addToast={addToast} typingStatus={typingStatus} setTypingStatus={setTypingStatus} setTab={setTab} setChatOpen={setChatOpen}/>
</div>
          </div>
        </div>
      )}
   {!chatOpen && <div style={s.tabBar}>
        {TABS.map((t)=>(
        <button key={t.id} onClick={()=>{
    setTab(t.id);
    setChatOpen(false);
    if (t.id==="social") { const upd={...lastSeen,social:posts.length}; setLastSeen(upd); storeSet(`lastSeen:${currentPlayer}`,upd); }
    if (t.id==="training") { const upd={...lastSeen,training:Object.keys(completions).filter(k=>k.endsWith(`__${currentPlayer}`)&&completions[k].status==="pending").length}; setLastSeen(upd); storeSet(`lastSeen:${currentPlayer}`,upd); }
  }} className="bb-pressable" style={s.tabBtn}>
            <div style={{position:"relative",display:"inline-flex"}}>
             <t.icon size={18} color={tab===t.id?(t.id==="admin"||t.id==="verify"?"#FF5C8A":"#B8FF4D"):"#4A5066"}/>
              {badges[t.id]>0&&<div style={{position:"absolute",top:-4,right:-6,background:"#FF5C8A",borderRadius:99,minWidth:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",padding:"0 3px"}}>{badges[t.id]}</div>}
            </div>
            <span style={{color:tab===t.id?(t.id==="admin"||t.id==="verify"?"#FF5C8A":"#B8FF4D"):"#4A5066",fontSize:9,fontWeight:600}}>{t.label}</span>
          </button>
        ))}
      </div>}
    </div>
  );
}

// ===================== Styles =====================
const s = {
appShell:{display:"flex",flexDirection:"column",height:"100dvh",minHeight:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"\'Inter\',-apple-system,sans-serif",width:"100%",position:"fixed",inset:0,overflow:"hidden",paddingBottom:0},
  screen:{height:"100dvh",minHeight:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"},
topBar:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px 12px",paddingTop:"max(14px, env(safe-area-inset-top))",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,position:"relative"},
  topBarTitle:{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600,letterSpacing:0.8,textTransform:"lowercase"},
  topBarRight:{display:"flex",alignItems:"center",gap:8},
  youDot:{width:8,height:8,borderRadius:99},
  youName:{fontSize:13,color:"#8B92A8"},
  logoutBtn:{background:"none",border:"none",color:"#4A5066",padding:4,marginLeft:4,cursor:"pointer"},
  tabBody:{flex:1,overflowY:"auto",overflowX:"hidden",paddingBottom:"calc(92px + env(safe-area-inset-bottom, 0px))",WebkitOverflowScrolling:"touch",minHeight:0,scrollbarWidth:"none",msOverflowStyle:"none"},
  tabContent:{padding:"16px 16px 24px"},
tabBar:{display:"flex",borderTop:"1px solid rgba(255,255,255,0.08)",background:"#0A0C16",flexShrink:0,paddingTop:8,paddingBottom:"max(10px, env(safe-area-inset-bottom, 0px))",overflowX:"auto",WebkitOverflowScrolling:"touch",position:"fixed",left:0,right:0,bottom:0,zIndex:600,maxWidth:480,margin:"0 auto",boxShadow:"0 -14px 28px rgba(0,0,0,0.35)"},
tabBtn:{flexShrink:0,minWidth:62,background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"7px 4px 5px",cursor:"pointer",outline:"none",WebkitTapHighlightColor:"transparent",borderRadius:14},
  reminderBanner:{display:"flex",alignItems:"center",gap:6,padding:"10px 14px",background:"rgba(255,92,138,0.08)",borderBottom:"1px solid rgba(255,92,138,0.2)",animation:"dropDown .3s cubic-bezier(.2,.8,.2,1)",flexShrink:0},
  reminderBtn:{flex:1,display:"flex",alignItems:"center",gap:10,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"},
  reminderTitle:{fontSize:12.5,fontWeight:700,color:"#FF5C8A"},
  reminderSub:{fontSize:11.5,color:"#8B92A8",marginTop:1},
  reminderClose:{background:"none",border:"none",color:"#8B92A8",padding:4,cursor:"pointer",flexShrink:0},
  loginScreen:{height:"100dvh",minHeight:"100dvh",background:"#06070D",color:"#E8ECF4",fontFamily:"'Inter',-apple-system,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"},
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
  primaryBtn:{width:"100%",background:"#B8FF4D",color:"#06070D",border:"none",borderRadius:14,padding:"14px",fontSize:13.5,fontWeight:800,cursor:"pointer",marginTop:4,boxShadow:"0 10px 24px rgba(184,255,77,0.14)"},
  heroCard:{background:"linear-gradient(135deg,#121526,#090B14)",border:"1px solid rgba(184,255,77,0.18)",borderRadius:20,padding:"22px 18px",marginBottom:16,boxShadow:"0 14px 34px rgba(0,0,0,0.22)"},
  heroEyebrow:{fontSize:11,letterSpacing:1.2,color:"#B8FF4D",fontWeight:700,marginBottom:14},
  heroMatchup:{display:"flex",alignItems:"center",justifyContent:"space-between"},
  heroTeam:{flex:1,textAlign:"center"},
  heroTeamName:{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:600,lineHeight:1.15,textTransform:"lowercase"},
  heroVs:{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 10px",color:"#4A5066",fontSize:12,fontWeight:700},
  heroBo:{fontSize:10,color:"#A78BFA",marginBottom:2,fontWeight:700},
  heroMeta:{textAlign:"center",marginTop:14,fontSize:12,color:"#8B92A8"},
  recordRow:{display:"flex",gap:10,marginBottom:24},
  recordBox:{flex:1,background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:16,padding:"15px 8px",textAlign:"center",border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 10px 24px rgba(0,0,0,0.16)"},
  recordNum:{fontFamily:"'Oswald',sans-serif",fontSize:21,fontWeight:600},
  recordLabel:{fontSize:9.5,letterSpacing:0.6,color:"#4A5066",marginTop:4,fontWeight:700},
  sectionRowHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10},
  sectionLabel:{fontSize:12,letterSpacing:1,color:"#4A5066",fontWeight:700,marginBottom:4},
  sectionSubLabel:{fontSize:12,color:"#4A5066",marginBottom:14},
  viewAllBtn:{background:"none",border:"none",color:"#A78BFA",fontSize:11.5,fontWeight:600,display:"flex",alignItems:"center",gap:2,cursor:"pointer"},
  dashTrainingScroll:{display:"flex",gap:10,overflowX:"auto",paddingBottom:6,marginBottom:4,WebkitOverflowScrolling:"touch"},
  dashTrainingCard:{minWidth:122,background:"linear-gradient(135deg,#11131F,#0B0D17)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:16,padding:"13px 12px",cursor:"pointer",flexShrink:0,boxShadow:"0 10px 22px rgba(0,0,0,0.16)"},
  dashTrainingDay:{fontSize:10.5,color:"#A78BFA",fontWeight:700,textTransform:"lowercase",marginBottom:6},
  dashTrainingTitle:{fontSize:12.5,fontWeight:600,lineHeight:1.3,marginBottom:8,minHeight:32},
  dashTrainingEmpty:{fontSize:11.5,color:"#3A4256",fontStyle:"italic",minHeight:32,display:"flex",alignItems:"center"},
  dashDoneTag:{fontSize:9.5,color:"#7CFFB2",fontWeight:700,display:"flex",alignItems:"center",gap:3},
  dashOpenTag:{fontSize:9.5,color:"#B8FF4D",fontWeight:700},
  dashPendingTag:{fontSize:9.5,color:"#FFD166",fontWeight:700},
  dashRejectedTag:{fontSize:9.5,color:"#FF5C8A",fontWeight:700},
  dashLockedTag:{fontSize:9.5,color:"#4A5066",fontWeight:700},
  blurredText:{filter:"blur(5px)",userSelect:"none",pointerEvents:"none"},
  mmrCard:{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,padding:16,marginBottom:12,border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 12px 28px rgba(0,0,0,0.18)"},
  mmrCardEmpty:{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,padding:16,marginBottom:12,border:"1px solid rgba(255,255,255,0.06)",boxShadow:"0 12px 28px rgba(0,0,0,0.16)"},
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
modalBox:{background:"linear-gradient(180deg,#121526,#0B0D17)",borderRadius:"24px 24px 0 0",padding:20,width:"100%",maxWidth:480,boxSizing:"border-box",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",maxHeight:"88vh",overflowY:"auto",paddingBottom:"max(80px, calc(env(safe-area-inset-bottom) + 60px))",boxShadow:"0 -18px 44px rgba(0,0,0,0.38)",animation:"modalSheetUp .22s cubic-bezier(.2,.8,.2,1)"},
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
  trainingCard:{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,padding:16,marginBottom:12,position:"relative",border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 12px 28px rgba(0,0,0,0.18)"},
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
  completeBtn:{flex:1,border:"none",borderRadius:13,padding:"12px 0",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",boxShadow:"0 10px 24px rgba(0,0,0,0.14)"},
  commentBtn:{width:42,background:"rgba(255,255,255,0.05)",border:"none",borderRadius:11,color:"#8B92A8",cursor:"pointer"},
  numericWrap:{marginTop:4},
  numericLabel:{fontSize:11.5,color:"#A78BFA",fontWeight:700,marginBottom:10},
  numericCounter:{display:"flex",alignItems:"center",justifyContent:"center",gap:18,background:"rgba(255,255,255,0.03)",borderRadius:13,padding:"10px 0"},
  counterBtn:{width:36,height:36,borderRadius:99,background:"rgba(255,255,255,0.07)",border:"none",color:"#E8ECF4",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"},
  counterVal:{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:600,minWidth:50,textAlign:"center"},
  chatTabWrap:{display:"flex",flexDirection:"column",flex:1,minHeight:0},
  chatHeader:{padding:"16px 16px 8px",flexShrink:0},
  chatScroll:{flex:1,overflowY:"auto",padding:"0 16px",WebkitOverflowScrolling:"touch",scrollBehavior:"auto",minHeight:0},
  chatEmpty:{textAlign:"center",color:"#4A5066",fontSize:13,marginTop:40},
  chatMsgRow:{display:"flex",marginBottom:10},
  chatBubble:{maxWidth:"78%",borderRadius:17,padding:"10px 13px",boxShadow:"0 8px 18px rgba(0,0,0,0.14)"},
  chatAuthor:{fontSize:11,fontWeight:700,marginBottom:3},
  chatText:{fontSize:14.5,lineHeight:1.4},
  chatTime:{fontSize:10,marginTop:4,textAlign:"right"},
chatInputRow:{display:"flex",gap:8,padding:"12px 16px",paddingBottom:"max(12px, env(safe-area-inset-bottom))",borderTop:"1px solid rgba(255,255,255,0.08)",background:"rgba(6,7,13,0.96)",flexShrink:0},
  chatInput:{flex:1,background:"#11131F",border:"1px solid rgba(255,255,255,0.12)",borderRadius:99,padding:"12px 16px",color:"#E8ECF4",fontSize:14,outline:"none",boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.02)"},
  chatSendBtn:{width:42,height:42,background:"#B8FF4D",border:"none",borderRadius:99,color:"#06070D",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0},
  commentItem:{display:"flex",gap:8,marginBottom:14},
  newPostBtn:{display:"flex",alignItems:"center",gap:5,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#A78BFA",fontSize:12,fontWeight:700,padding:"7px 12px",borderRadius:99,cursor:"pointer"},
  emptyQueue:{textAlign:"center",color:"#4A5066",fontSize:13,marginTop:30,lineHeight:1.5,padding:"0 10px"},
  postCard:{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:18,marginBottom:14,border:"1px solid rgba(255,255,255,0.08)",overflow:"hidden",position:"relative",boxShadow:"0 12px 28px rgba(0,0,0,0.18)"},
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
  verifyCard:{background:"linear-gradient(135deg,#11131F,#0B0D17)",borderRadius:16,padding:15,marginBottom:10,border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 10px 24px rgba(0,0,0,0.16)"},
  verifyCardTop:{display:"flex",justifyContent:"space-between",marginBottom:6},
  verifyDate:{fontSize:12,color:"#A78BFA",fontWeight:700},
  verifySubmittedAt:{fontSize:11,color:"#4A5066"},
  verifyTitle:{fontSize:15,fontWeight:700,marginBottom:4},
  verifyAmount:{fontSize:13,color:"#8B92A8"},
  verifyActionsRow:{display:"flex",gap:8},
  rejectBtn:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(255,92,138,0.1)",border:"1px solid rgba(255,92,138,0.32)",color:"#FF5C8A",borderRadius:12,padding:"11px 0",fontSize:12.5,fontWeight:800,cursor:"pointer",boxShadow:"0 10px 24px rgba(0,0,0,0.12)"},
  approveBtn:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"#B8FF4D",border:"none",color:"#06070D",borderRadius:12,padding:"11px 0",fontSize:12.5,fontWeight:800,cursor:"pointer",boxShadow:"0 10px 24px rgba(184,255,77,0.12)"},
  streamEmbed:{width:"100%",aspectRatio:"16/9",background:"#000",borderRadius:14,overflow:"hidden",marginBottom:12},
  streamBelowEmbed:{textAlign:"right",marginBottom:16},
  twitchLink:{color:"#9146FF",fontSize:12.5,fontWeight:700,textDecoration:"none"},
  twitchEditCard:{background:"#11131F",border:"1px solid rgba(167,139,250,0.2)",borderRadius:14,padding:14,marginBottom:16},
  streamPlayerCard:{background:"#11131F",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,padding:"14px 16px",display:"flex",alignItems:"center",gap:12},
  watchBtn:{display:"flex",alignItems:"center",gap:6,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"#A78BFA",fontSize:12.5,fontWeight:700,padding:"8px 14px",borderRadius:99,cursor:"pointer",flexShrink:0},
  offlineChip:{fontSize:11,color:"#4A5066",fontWeight:700,background:"rgba(255,255,255,0.04)",padding:"4px 10px",borderRadius:99},
  streamNote:{background:"rgba(167,139,250,0.06)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:14,padding:14,marginTop:20},
};