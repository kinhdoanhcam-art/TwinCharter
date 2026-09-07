import { useEffect, useMemo, useState } from 'react';
import {
  acceptSplitTx, cleanError, connectWallet, createWorkspaceTx, executionErrorDetail,
  executionOutcome, getChild, getConfig, getSplit, getSplits, getWorkspace,
  proposeSplitTx, txExplorerUrl, waitFinalized, withdrawSplitTx,
} from './genlayer';
import {
  CONTRACT_ADDRESS, CONTRACT_EXPLORER_URL, EXPECTED_CONTRACT_VERSION,
  RUNTIME_EVIDENCE_ADDRESS, RUNTIME_EXPLORER_URL, SOURCE_SHA256, ZERO_ADDRESS,
} from './config';
import type { Address, Child, Split, SplitConfig, TxHash, Workspace } from './types';

type Page = 'deck' | 'intake' | 'workspace' | 'splitlab' | 'acceptance' | 'ledger' | 'proof';

const nav: { key: Page; label: string; code: string }[] = [
  { key: 'deck', label: 'Deck', code: '00' }, { key: 'intake', label: 'Charter intake', code: '01' },
  { key: 'workspace', label: 'Workspace', code: '02' }, { key: 'splitlab', label: 'Split lab', code: '03' },
  { key: 'acceptance', label: 'Acceptance', code: '04' }, { key: 'ledger', label: 'Ledger', code: '05' },
  { key: 'proof', label: 'Proof', code: '06' },
];

function short(v?: string, left = 6, right = 4) { if (!v) return '—'; return v.length <= left + right + 3 ? v : `${v.slice(0,left)}…${v.slice(-right)}`; }
function eq(a?: string, b?: string) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
function n(v: string) { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : 0; }
function clip(v: string) { navigator.clipboard?.writeText(v).catch(() => undefined); }
function tone(status?: string) {
  if (status === 'ACTIVATED' || status === 'CLOSED') return 'good';
  if (status === 'GAP') return 'bad';
  if (status === 'PENDING_DUAL_ACCEPTANCE') return 'wait';
  if (status === 'WITHDRAWN') return 'muted';
  return 'neutral';
}

function Logo({ compact=false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}>
    <img src="/logo.svg" alt="TwinCharter" />
    {!compact && <div><strong>TwinCharter</strong><span>coverage before transfer</span></div>}
  </div>;
}

function Pill({ children, kind='neutral' }: { children: any; kind?: string }) { return <span className={`pill ${kind}`}>{children}</span>; }
function Kicker({ children }: { children: any }) { return <div className="kicker">{children}</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><div className="splitmark"><i/><i/></div><h3>{title}</h3><p>{text}</p></div>; }

export default function App() {
  const [page, setPage] = useState<Page>(() => (location.hash.replace('#/','') as Page) || 'deck');
  const [config, setConfig] = useState<SplitConfig | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [workspaceId, setWorkspaceId] = useState<number>(0);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeSplit, setActiveSplit] = useState<Split | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<TxHash | null>(null);

  const [parentCharter, setParentCharter] = useState('');
  const [openWorkspaceId, setOpenWorkspaceId] = useState('');
  const [successorA, setSuccessorA] = useState('');
  const [successorB, setSuccessorB] = useState('');
  const [charterA, setCharterA] = useState('');
  const [charterB, setCharterB] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('1');
  const [ledgerCount, setLedgerCount] = useState('20');

  const profileMatched = Boolean(config && config.name === 'ResponsibilitySplit' && config.version === EXPECTED_CONTRACT_VERSION && config.arity === 2 && config.cache_scope === 'WORKSPACE' && config.max_semantic_evals_per_workspace === 8);
  const isResponsible = Boolean(account && workspace && eq(account, workspace.current_responsible));
  const successorRole = useMemo(() => activeSplit && account ? (eq(account, activeSplit.successor_a) ? 'A' : eq(account, activeSplit.successor_b) ? 'B' : '') : '', [activeSplit, account]);

  function go(next: Page) { location.hash = `#/${next}`; setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  useEffect(() => {
    const onHash = () => setPage((location.hash.replace('#/','') as Page) || 'deck');
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { refreshConfig(); }, []);

  async function refreshConfig() {
    try { setConfig(await getConfig()); } catch (e) { setError(cleanError(e)); }
  }

  async function connect() {
    setError('');
    try { const a = await connectWallet(); setAccount(a); setNotice(`Wallet connected: ${short(a,8,6)}`); }
    catch (e) { setError(cleanError(e)); }
  }

  async function loadWorkspace(id = workspaceId) {
    if (!id) throw new Error('Enter a valid workspace ID.');
    const ws = await getWorkspace(id);
    setWorkspaceId(id); setOpenWorkspaceId(String(id)); setWorkspace(ws);
    let split: Split | null = null;
    if (ws.active_split_id > 0) split = await getSplit(id, ws.active_split_id);
    setActiveSplit(split);
    const childRows: Child[] = [];
    for (let i=1; i<=ws.active_children_count; i++) childRows.push(await getChild(id,i));
    setChildren(childRows);
    setNotice(`Workspace #${id} loaded from finalized state.`);
    return ws;
  }

  async function loadLedger(id = workspaceId) {
    if (!id) throw new Error('Open a workspace first.');
    const rows = await getSplits(id, n(ledgerFrom) || 1, Math.min(50, n(ledgerCount) || 20));
    setSplits(rows); return rows;
  }

  async function runWrite(label: string, submit: () => Promise<TxHash>, verify: () => Promise<void>) {
    setBusy(true); setError(''); setTxHash(null); setNotice(`${label}: requesting wallet signature…`);
    try {
      const hash = await submit(); setTxHash(hash); setNotice(`${label}: submitted ${short(hash,10,8)} · waiting for finalization…`);
      const receipt = await waitFinalized(hash); const outcome = executionOutcome(receipt);
      if (outcome.ok === false) throw new Error(executionErrorDetail(receipt));
      await verify();
      setNotice(outcome.ok === true ? `${label}: execution and finalized postcondition verified.` : `${label}: finalized postcondition verified (execution enum unavailable from SDK).`);
    } catch (e) { setError(cleanError(e)); }
    finally { setBusy(false); }
  }

  async function createWorkspace() {
    if (!account) return setError('Connect a wallet first.');
    const clean = parentCharter.trim(); if (!clean) return setError('Parent charter cannot be empty.');
    const before = config?.workspace_count ?? (await getConfig()).workspace_count;
    await runWrite('Create workspace', () => createWorkspaceTx(account, clean), async () => {
      const cfg = await getConfig();
      if (cfg.workspace_count !== before + 1) throw new Error('Finalized workspace counter did not increment exactly once.');
      const ws = await getWorkspace(cfg.workspace_count);
      if (!eq(ws.current_responsible, account) || ws.parent_charter !== clean || ws.parent_status !== 'ACTIVE' || ws.split_count !== 0) throw new Error('Finalized workspace postcondition mismatch.');
      setConfig(cfg); setWorkspaceId(ws.workspace_id); setOpenWorkspaceId(String(ws.workspace_id)); setWorkspace(ws); setActiveSplit(null); setChildren([]); setParentCharter(''); go('workspace');
    });
  }

  async function propose() {
    if (!account || !workspace) return setError('Connect the responsible wallet and open a workspace first.');
    if (!isResponsible) return setError('Only the current responsible party may propose a split.');
    const a=successorA.trim(), b=successorB.trim(), ca=charterA.trim(), cb=charterB.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(a) || !/^0x[a-fA-F0-9]{40}$/.test(b)) return setError('Enter two valid successor addresses.');
    if (!ca || !cb) return setError('Both child charters are required.');
    const before = { ...workspace };
    await runWrite('Propose split', () => proposeSplitTx(account, workspace.workspace_id, a, ca, b, cb), async () => {
      const ws = await getWorkspace(workspace.workspace_id);
      if (ws.split_count !== before.split_count + 1) throw new Error('Finalized split counter did not increment exactly once.');
      const s = await getSplit(ws.workspace_id, ws.split_count);
      if (!eq(s.proposer, account) || !eq(s.successor_a,a) || !eq(s.successor_b,b) || s.charter_a !== ca || s.charter_b !== cb) throw new Error('Finalized split record does not match submitted proposal.');
      const evalDelta = ws.semantic_eval_count - before.semantic_eval_count;
      if (evalDelta !== (s.used_cache ? 0 : 1)) throw new Error('Semantic evaluation accounting mismatch.');
      if (s.verdict === 'SPLIT_COVERS_PARENT' && ws.active_split_id !== s.split_id) throw new Error('Covering split did not enter dual acceptance.');
      if (s.verdict === 'SPLIT_HAS_GAP' && (ws.active_split_id !== 0 || ws.gap_attempts !== before.gap_attempts + 1)) throw new Error('Gap consequence mismatch.');
      setWorkspace(ws); setActiveSplit(s.verdict === 'SPLIT_COVERS_PARENT' ? s : null); setSuccessorA(''); setSuccessorB(''); setCharterA(''); setCharterB(''); await loadLedger(ws.workspace_id); go(s.verdict === 'SPLIT_COVERS_PARENT' ? 'acceptance' : 'ledger');
    });
  }

  async function accept() {
    if (!account || !workspace || !activeSplit) return setError('Open a workspace with a pending split first.');
    if (!successorRole) return setError('Connected wallet is not a proposed successor for this split.');
    const before = { ...activeSplit };
    await runWrite(`Successor ${successorRole} acceptance`, () => acceptSplitTx(account, workspace.workspace_id, activeSplit.split_id), async () => {
      const s = await getSplit(workspace.workspace_id, activeSplit.split_id);
      const ws = await getWorkspace(workspace.workspace_id);
      if (successorRole === 'A' && !s.accepted_a) throw new Error('Finalized state did not record successor A acceptance.');
      if (successorRole === 'B' && !s.accepted_b) throw new Error('Finalized state did not record successor B acceptance.');
      if (!(s.accepted_a && s.accepted_b)) {
        if (s.activated || ws.parent_status !== 'ACTIVE' || ws.active_split_id !== s.split_id || ws.active_children_count !== 0) throw new Error('Partial acceptance moved responsibility prematurely.');
        setActiveSplit(s); setWorkspace(ws); return;
      }
      if (!s.activated || s.status !== 'ACTIVATED' || ws.parent_status !== 'CLOSED' || !eq(ws.current_responsible,ZERO_ADDRESS) || ws.active_children_count !== 2 || ws.active_split_id !== 0) throw new Error('Dual-acceptance activation postcondition mismatch.');
      const c1=await getChild(ws.workspace_id,1), c2=await getChild(ws.workspace_id,2);
      if (!c1.active || !c2.active || c1.source_split_id !== s.split_id || c2.source_split_id !== s.split_id || !eq(c1.responsible,s.successor_a) || !eq(c2.responsible,s.successor_b)) throw new Error('Activated child records do not match the accepted split.');
      setActiveSplit(null); setWorkspace(ws); setChildren([c1,c2]);
    });
  }

  async function withdraw() {
    if (!account || !workspace || !activeSplit) return setError('Open a workspace with a pending split first.');
    if (!isResponsible) return setError('Only the current responsible party may withdraw a split.');
    const id=activeSplit.split_id;
    await runWrite('Withdraw split', () => withdrawSplitTx(account,workspace.workspace_id,id), async () => {
      const s=await getSplit(workspace.workspace_id,id), ws=await getWorkspace(workspace.workspace_id);
      if (!s.withdrawn || s.status !== 'WITHDRAWN' || ws.active_split_id !== 0 || ws.parent_status !== 'ACTIVE') throw new Error('Finalized withdrawal postcondition mismatch.');
      setActiveSplit(null); setWorkspace(ws); await loadLedger(ws.workspace_id); go('ledger');
    });
  }

  async function openWorkspaceFromInput() {
    setBusy(true); setError(''); try { await loadWorkspace(n(openWorkspaceId)); go('workspace'); } catch(e){ setError(cleanError(e)); } finally { setBusy(false); }
  }

  async function refreshOpened() { if (!workspaceId) return; setBusy(true); setError(''); try { await loadWorkspace(workspaceId); if (page==='ledger') await loadLedger(workspaceId); } catch(e){setError(cleanError(e));} finally{setBusy(false);} }

  return <div className="app-shell">
    <header className="topbar">
      <Logo />
      <nav>{nav.map(item => <button key={item.key} className={page===item.key?'active':''} onClick={()=>go(item.key)}><span>{item.code}</span>{item.label}</button>)}</nav>
      <div className="wallet-zone">
        <a className="contract-chip" href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer"><i className={profileMatched?'live':'off'}/>{short(CONTRACT_ADDRESS,7,6)}</a>
        <button className="wallet" onClick={connect}>{account ? short(account,7,6) : 'Connect wallet'}</button>
      </div>
    </header>

    {(notice || error || txHash) && <div className={`signal ${error?'error':''}`}><b>{error?'FAULT':'SIGNAL'}</b><span>{error || notice}</span>{txHash && <a href={txExplorerUrl(txHash)} target="_blank" rel="noreferrer">TX ↗</a>}</div>}

    <main>
      {page==='deck' && <section className="page deck">
        <div className="hero-grid">
          <div className="hero-copy"><Kicker>FIXED-ARITY RESPONSIBILITY HANDOFF</Kicker><h1>One charter in.<br/><em>Two accountable lanes out.</em></h1><p>TwinCharter checks whether two successor charters, taken together, preserve every material duty in one immutable parent charter. Coverage first. Transfer only after both successors accept.</p><div className="hero-actions"><button className="primary" onClick={()=>go('intake')}>Open charter intake →</button><button className="ghost" onClick={()=>go('workspace')}>Inspect finalized state</button></div></div>
          <div className="routing-board"><div className="board-label">TRANSFER MAP / 2-WAY ONLY</div><div className="parent-node"><small>PARENT CHARTER</small><strong>immutable scope</strong></div><div className="trunk"/><div className="branches"><div/><div/></div><div className="child-row"><article><span>A</span><small>SUCCESSOR LANE</small><strong>child charter</strong></article><article><span>B</span><small>SUCCESSOR LANE</small><strong>child charter</strong></article></div><div className="gate-row"><Pill kind="lime">UNION COVERAGE</Pill><Pill kind="blue">2 / 2 ACCEPTANCE</Pill></div></div>
        </div>
        <div className="metrics"><div><span>WORKSPACES</span><strong>{config?.workspace_count ?? '—'}</strong><small>finalized</small></div><div><span>ARITY</span><strong>{config?.arity ?? '—'}</strong><small>fixed successors</small></div><div><span>SEMANTIC BUDGET</span><strong>{config?.max_semantic_evals_per_workspace ?? '—'}</strong><small>fresh / workspace</small></div><div><span>CACHE</span><strong>{config?.cache_scope ?? '—'}</strong><small>isolation scope</small></div></div>
        <div className="principles"><article><Kicker>RULE 01</Kicker><h2>Coverage is by union.</h2><p>Overlap is allowed. Missing, weakened, negated, or contradictory parent responsibilities fail toward a recoverable GAP.</p></article><article><Kicker>RULE 02</Kicker><h2>One acceptance moves nothing.</h2><p>The parent stays active until both named successors accept the exact covering split.</p></article><article><Kicker>RULE 03</Kicker><h2>The model does not assign roles.</h2><p>Validators answer one narrow coverage question. Addresses, acceptance, activation, and consequences stay deterministic.</p></article></div>
      </section>}

      {page==='intake' && <section className="page"><div className="page-head"><div><Kicker>01 / CHARTER INTAKE</Kicker><h1>Lock the parent scope.</h1><p>The creator becomes the current responsible party. The parent charter is immutable for the life of this workspace.</p></div><StatusRail config={config} /></div><div className="form-stage"><div className="stage-index">PARENT<br/>/00</div><div className="field-stack"><label>IMMUTABLE PARENT CHARTER<textarea value={parentCharter} onChange={e=>setParentCharter(e.target.value)} maxLength={4000} placeholder="Describe every material responsibility that must survive the split."/><span>{parentCharter.length} / 4000</span></label><div className="write-footer"><div><small>CREATOR</small><strong>{account ? short(account,10,8) : 'Connect wallet first'}</strong></div><button className="primary" disabled={busy || !account || !parentCharter.trim()} onClick={createWorkspace}>Create workspace →</button></div></div></div></section>}

      {page==='workspace' && <section className="page"><div className="page-head"><div><Kicker>02 / WORKSPACE</Kicker><h1>Finalized responsibility map.</h1><p>Open any workspace ID. Nothing on this screen is treated as evidence until it is read from finalized contract state.</p></div><div className="open-box"><input inputMode="numeric" placeholder="Workspace ID" value={openWorkspaceId} onChange={e=>setOpenWorkspaceId(e.target.value)}/><button onClick={openWorkspaceFromInput} disabled={busy}>Open</button></div></div>{workspace ? <WorkspaceView workspace={workspace} activeSplit={activeSplit} children={children} account={account} onRefresh={refreshOpened} onGo={go}/> : <Empty title="No workspace loaded" text="Enter a workspace ID to inspect its immutable parent, pending split, or activated child lanes."/>}</section>}

      {page==='splitlab' && <section className="page"><div className="page-head"><div><Kicker>03 / SPLIT LAB</Kicker><h1>Design two lanes. Preserve one scope.</h1><p>The semantic call checks only the union of both child charters against the immutable parent. It does not score fairness or pick successors.</p></div><WorkspaceBadge workspace={workspace}/></div>{workspace ? <div className="lab-grid"><div className="parent-reference"><Kicker>IMMUTABLE REFERENCE</Kicker><h3>Parent charter</h3><p>{workspace.parent_charter}</p><div className="budget"><span>semantic calls</span><strong>{workspace.semantic_eval_count} / {config?.max_semantic_evals_per_workspace ?? 8}</strong></div></div><div className="lanes"><Lane label="A" address={successorA} setAddress={setSuccessorA} charter={charterA} setCharter={setCharterA}/><div className="plus">+</div><Lane label="B" address={successorB} setAddress={setSuccessorB} charter={charterB} setCharter={setCharterB}/><div className="semantic-rule"><span>UNION CHECK</span><p>Every material parent responsibility must remain clearly preserved across A + B. Overlap is valid.</p><button className="primary" disabled={busy || !isResponsible || workspace.parent_status!=='ACTIVE' || workspace.active_split_id>0 || !successorA || !successorB || !charterA.trim() || !charterB.trim()} onClick={propose}>Run coverage check →</button><small>{isResponsible ? 'Write permission: current responsible wallet' : 'Connect the current responsible wallet to propose.'}</small></div></div></div> : <Empty title="Open a workspace first" text="The split lab needs a finalized parent charter before it can construct successor lanes."/>}</section>}

      {page==='acceptance' && <section className="page"><div className="page-head"><div><Kicker>04 / ACCEPTANCE GATE</Kicker><h1>Two signatures before transfer.</h1><p>A covering verdict does not move responsibility. Both named successors must accept the same pending split.</p></div><WorkspaceBadge workspace={workspace}/></div>{workspace && activeSplit ? <div className="accept-grid"><article className="split-ticket"><div className="ticket-head"><Pill kind={activeSplit.verdict==='SPLIT_COVERS_PARENT'?'lime':'red'}>{activeSplit.verdict}</Pill><span>split #{activeSplit.split_id}</span></div><h2>Pending dual acceptance</h2><p>Parent remains <b>{workspace.parent_status}</b> until both lanes are accepted.</p><div className="accept-lanes"><AcceptanceLane label="A" address={activeSplit.successor_a} charter={activeSplit.charter_a} accepted={activeSplit.accepted_a} account={account}/><AcceptanceLane label="B" address={activeSplit.successor_b} charter={activeSplit.charter_b} accepted={activeSplit.accepted_b} account={account}/></div></article><aside className="gate-panel"><Kicker>CONNECTED ROLE</Kicker><strong>{successorRole ? `Successor ${successorRole}` : isResponsible ? 'Current responsible' : 'Observer'}</strong><p>{successorRole ? 'This wallet may record its acceptance.' : isResponsible ? 'You may withdraw while the split is still pending.' : 'Connect a named successor to accept.'}</p>{successorRole && <button className="primary" disabled={busy || (successorRole==='A'?activeSplit.accepted_a:activeSplit.accepted_b)} onClick={accept}>Accept split →</button>}{isResponsible && <button className="danger" disabled={busy} onClick={withdraw}>Withdraw pending split</button>}</aside></div> : <Empty title="No pending covering split" text="A SPLIT_COVERS_PARENT proposal appears here until both successors accept or the current responsible party withdraws it."/>}</section>}

      {page==='ledger' && <section className="page"><div className="page-head"><div><Kicker>05 / SPLIT LEDGER</Kicker><h1>Every attempt stays visible.</h1><p>Gap attempts, cache reuse, pending acceptance, withdrawals, and activation are read from finalized state.</p></div><div className="ledger-tools"><input value={ledgerFrom} onChange={e=>setLedgerFrom(e.target.value)} aria-label="from split"/><input value={ledgerCount} onChange={e=>setLedgerCount(e.target.value)} aria-label="count"/><button disabled={!workspaceId || busy} onClick={()=>loadLedger().catch(e=>setError(cleanError(e)))}>Load</button></div></div>{workspaceId ? <>{splits.length ? <div className="ledger-table"><div className="ledger-header"><span>ID</span><span>VERDICT</span><span>STATUS</span><span>CACHE</span><span>A</span><span>B</span></div>{splits.map(s=><button key={s.split_id} className="ledger-row" onClick={async()=>{try{const full=await getSplit(workspaceId,s.split_id); setActiveSplit(full); go('acceptance');}catch(e){setError(cleanError(e));}}}><span>#{s.split_id}</span><span><Pill kind={s.verdict==='SPLIT_COVERS_PARENT'?'lime':'red'}>{s.verdict.replace('SPLIT_','')}</Pill></span><span><Pill kind={tone(s.status)}>{s.status}</Pill></span><span>{s.used_cache?'HIT':'FRESH'}</span><span>{s.accepted_a?'✓':'—'}</span><span>{s.accepted_b?'✓':'—'}</span></button>)}</div> : <Empty title="Ledger is empty" text="Load a workspace with split attempts, or create a new proposal in Split lab."/>}</> : <Empty title="Open a workspace first" text="The ledger is scoped to one workspace and never mixes cache or attempt history across workspaces."/>}</section>}

      {page==='proof' && <section className="page"><div className="page-head"><div><Kicker>06 / VERIFICATION</Kicker><h1>Frozen contract. Separate runtime proof.</h1><p>The clean project deployment is distinct from the runtime-evidence deployment used to exercise the load-bearing paths.</p></div><Pill kind={profileMatched?'lime':'red'}>{profileMatched?'LIVE PROFILE MATCHED':'PROFILE MISMATCH'}</Pill></div><div className="proof-grid"><ProofCard label="PROJECT CONTRACT" value={CONTRACT_ADDRESS} href={CONTRACT_EXPLORER_URL} note="Frontend target. Fresh deployment intended to start with zero workspaces."/><ProofCard label="RUNTIME EVIDENCE" value={RUNTIME_EVIDENCE_ADDRESS} href={RUNTIME_EXPLORER_URL} note="Separate deployment used for the finalized behavioral checks."/><div className="hash-card"><div><Kicker>FROZEN SOURCE SHA256</Kicker><code>{SOURCE_SHA256}</code></div><button onClick={()=>clip(SOURCE_SHA256)}>Copy hash</button></div></div><div className="proof-list"><ProofRow n="01" title="Gap consequence" text="Missing weekly-report scope produced SPLIT_HAS_GAP and kept the parent active."/><ProofRow n="02" title="Same-workspace reroll prevention" text="Exact retry returned used_cache=true while semantic_eval_count stayed unchanged."/><ProofRow n="03" title="Coverage with overlap" text="Two overlapping child charters jointly preserved the full parent and entered dual acceptance."/><ProofRow n="04" title="Partial acceptance safety" text="One successor accepted; parent responsibility remained active and no children were created."/><ProofRow n="05" title="Dual-acceptance transfer" text="Second acceptance closed the parent and created exactly two active child responsibilities at epoch 1."/><ProofRow n="06" title="Cross-workspace cache isolation" text="The same GAP candidate in Workspace #2 classified fresh with used_cache=false."/></div></section>}
    </main>

    <footer><Logo compact/><span>TwinCharter · ResponsibilitySplit v{config?.version || EXPECTED_CONTRACT_VERSION}</span><span>Semantic coverage is narrow. Transfer consequences are deterministic.</span><a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">StudioNet ↗</a></footer>
  </div>;
}

function StatusRail({config}:{config:SplitConfig|null}) { return <div className="status-rail"><span><i className={config?'on':''}/>{config?'Contract reachable':'Loading contract'}</span><span>arity {config?.arity ?? '—'}</span><span>cache {config?.cache_scope ?? '—'}</span></div>; }
function WorkspaceBadge({workspace}:{workspace:Workspace|null}) { return <div className="workspace-badge"><small>WORKSPACE</small><strong>{workspace ? `#${workspace.workspace_id}` : 'not loaded'}</strong><span>{workspace?.parent_status || '—'}</span></div>; }
function Lane({label,address,setAddress,charter,setCharter}:{label:string,address:string,setAddress:(s:string)=>void,charter:string,setCharter:(s:string)=>void}) { return <article className="lane"><div className="lane-id">{label}</div><label>SUCCESSOR ADDRESS<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="0x…"/></label><label>CHILD CHARTER<textarea value={charter} onChange={e=>setCharter(e.target.value)} maxLength={4000} placeholder="Responsibilities assigned to this successor."/><span>{charter.length} / 4000</span></label></article>; }
function AcceptanceLane({label,address,charter,accepted,account}:{label:string,address:string,charter:string,accepted:boolean,account:Address|null}) { return <div className={`accept-lane ${accepted?'accepted':''}`}><div className="lane-top"><b>{label}</b><span>{short(address,8,6)}</span><Pill kind={accepted?'lime':eq(address,account||'')?'blue':'neutral'}>{accepted?'ACCEPTED':eq(address,account||'')?'YOUR LANE':'WAITING'}</Pill></div><p>{charter}</p></div>; }
function WorkspaceView({workspace,activeSplit,children,account,onRefresh,onGo}:{workspace:Workspace,activeSplit:Split|null,children:Child[],account:Address|null,onRefresh:()=>void,onGo:(p:Page)=>void}) { return <div className="workspace-map"><div className="map-toolbar"><div><Pill kind={tone(workspace.parent_status)}>{workspace.parent_status}</Pill><span>epoch {workspace.epoch}</span><span>{workspace.split_count} split attempts</span><span>{workspace.semantic_eval_count} semantic calls</span></div><button onClick={onRefresh}>Refresh finalized state</button></div><article className="parent-card"><Kicker>PARENT / IMMUTABLE</Kicker><h2>Current responsibility</h2><p>{workspace.parent_charter}</p><div className="address-line"><span>responsible</span><code>{workspace.current_responsible}</code>{account && eq(account,workspace.current_responsible)&&<Pill kind="blue">YOU</Pill>}</div></article>{activeSplit && <div className="pending-strip"><div><Pill kind="lime">COVERS PARENT</Pill><strong>Split #{activeSplit.split_id} waits for 2 / 2 acceptance</strong></div><button onClick={()=>onGo('acceptance')}>Open acceptance gate →</button></div>}{children.length===2 && <div className="child-map"><div className="junction">TRANSFERRED</div>{children.map(c=><article key={c.child_index}><span>CHILD {c.child_index}</span><strong>{short(c.responsible,10,8)}</strong><p>{c.charter_text}</p><small>epoch {c.epoch} · source split #{c.source_split_id}</small></article>)}</div>}{workspace.parent_status==='ACTIVE' && !activeSplit && <button className="primary wide" onClick={()=>onGo('splitlab')}>Design a two-way split →</button>}</div>; }
function ProofCard({label,value,href,note}:{label:string,value:string,href:string,note:string}) { return <article className="proof-card"><Kicker>{label}</Kicker><code>{short(value,12,10)}</code><p>{note}</p><a href={href} target="_blank" rel="noreferrer">Open in Explorer ↗</a></article>; }
function ProofRow({n,title,text}:{n:string,title:string,text:string}) { return <div className="proof-row"><b>{n}</b><strong>{title}</strong><span>{text}</span><Pill kind="lime">PASS</Pill></div>; }
