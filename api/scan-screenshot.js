function TournamentOCRTab({ schedule, setSchedule, currentPlayer }) {
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const isCaptain = currentPlayer === ADMIN_ID;

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImage(URL.createObjectURL(f));
    setMediaType(f.type);
    setParsed(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(f);
  };

  const runScan = async () => {
    if (!imageBase64) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mediaType })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setParsed(data);
    } catch (e) {
      setError("couldn't read the screenshot — try a clearer one");
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
      result: (parsed.ourScore != null && parsed.theirScore != null) ? {
        status: parsed.ourScore > parsed.theirScore ? "win" : "loss",
        ours: parsed.ourScore,
        theirs: parsed.theirScore,
      } : m.result,
    } : m);
    const next = { ...schedule, [key]: updated };
    setSchedule(next);
    await storeSet("schedule", next);
    setParsed(null); setImage(null); setImageBase64(null);
  };

  const upcomingMatches = [...schedule.league, ...schedule.playoffs].filter(m => !m.result);

  return (
    <div>
      <div style={{ fontSize:11, color:"#4A5066", marginBottom:16, lineHeight:1.5 }}>
        upload a screenshot of the postgame screen — claude will read the score and opponent automatically.
      </div>

      <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display:"none" }}/>
      <button onClick={() => fileRef.current?.click()} className="bb-pressable"
        style={{ width:"100%", minHeight:160, background:"rgba(255,255,255,0.03)", border:"1px dashed rgba(255,255,255,0.15)", borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", marginBottom:14 }}>
        {image
          ? <img src={image} alt="screenshot" style={{ width:"100%", maxHeight:260, objectFit:"contain" }}/>
          : <><ImageIcon size={26} color="#4A5066"/><span style={{ color:"#4A5066", fontSize:13, marginTop:8 }}>tap to upload a screenshot</span></>
        }
      </button>

      {image && !parsed && (
        <button onClick={runScan} disabled={scanning} className="bb-pressable bb-glow-lime"
          style={{ ...s.primaryBtn, opacity: scanning ? 0.6 : 1 }}>
          {scanning ? "scanning…" : "scan screenshot"}
        </button>
      )}

      {error && <div style={{ fontSize:13, color:"#FF5C8A", marginTop:12, textAlign:"center" }}>{error}</div>}

      {parsed && (
        <div style={{ background:"#11131F", borderRadius:14, padding:14, marginTop:14, border:"1px solid rgba(184,255,77,0.2)" }}>
          <div style={{ fontSize:11, color:"#B8FF4D", fontWeight:700, letterSpacing:0.8, marginBottom:10 }}>DETECTED RESULT</div>
          <div style={{ marginBottom:8 }}>
            <div style={s.modalLabel}>opponent</div>
            <input value={parsed.opponent || ""} onChange={e=>setParsed(p=>({...p,opponent:e.target.value}))} style={s.modalInput}/>
          </div>
          <div style={s.modalScoreRow}>
            <div style={{flex:1}}><div style={s.modalLabel}>us</div><input type="number" value={parsed.ourScore ?? ""} onChange={e=>setParsed(p=>({...p,ourScore:Number(e.target.value)}))} style={s.modalInput}/></div>
            <div style={{flex:1}}><div style={s.modalLabel}>them</div><input type="number" value={parsed.theirScore ?? ""} onChange={e=>setParsed(p=>({...p,theirScore:Number(e.target.value)}))} style={s.modalInput}/></div>
          </div>

          {isCaptain ? (
            <>
              <div style={s.modalLabel}>apply to which match?</div>
              {upcomingMatches.length === 0 && <div style={{ fontSize:12, color:"#4A5066", marginTop:6 }}>no upcoming matches.</div>}
              {upcomingMatches.map(m => (
                <button key={m.id} onClick={() => applyToMatch(m.id)} className="bb-pressable bb-glow-lime"
                  style={{ width:"100%", textAlign:"left", background:"rgba(184,255,77,0.08)", border:"1px solid rgba(184,255,77,0.25)", borderRadius:10, padding:"10px 12px", marginTop:8, cursor:"pointer", color:"#E8ECF4", fontSize:12.5 }}>
                  {m.label} — {m.opponent || "tbd"}
                </button>
              ))}
            </>
          ) : (
            <div style={{ fontSize:12, color:"#4A5066", marginTop:10 }}>only the captain can apply this to the bracket.</div>
          )}

          <button onClick={() => { setParsed(null); setImage(null); setImageBase64(null); }} className="bb-pressable"
            style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"9px 0", fontSize:11.5, color:"#8B92A8", cursor:"pointer", marginTop:10 }}>
            scan another
          </button>
        </div>
      )}
    </div>
  );
}