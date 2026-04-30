// 그린마린 양하 검수앱 (모바일용, Firebase 실시간 동기화)
// 개발자: 연지아빠

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, MapPin, ArrowDownToLine, Upload, Check, X,
  ScanLine, FileText, Trash2, ChevronLeft, ChevronRight,
  RefreshCw, User, Cloud, CloudOff
} from 'lucide-react';
import { 
  fmtPos, formatWt, isoToLabel, 
  parseBAPLIE, parseAscFile, parseListExcel, parseXrayList 
} from './utils.js';
import {
  fbAddVoyage, fbUpdateVoyage, fbDeleteVoyage,
  fbCompleteContainer, fbCancelComplete,
  fbToggleXray, fbAddXrayBulk, fbSetXraySeal,
  fbSubscribeVoyages, fbSubscribeAllCompleted,
  fbSubscribeXray, fbSubscribeXraySeals,
  makeVoyageKey
} from './firebase.js';

const INSPECTOR_KEY = 'discharge_active_inspector';
const INSPECTORS_KEY = 'discharge_inspectors';
const ACTIVE_KEY = 'discharge_active_voyage';

export default function App() {
  const [voyagesAll, setVoyagesAll] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [completedAll, setCompletedAll] = useState({});
  const [xrayList, setXrayList] = useState({});
  const [xraySeals, setXraySeals] = useState({});
  const [tab, setTab] = useState('list');
  const [query, setQuery] = useState('');
  const [selectedCn, setSelectedCn] = useState(null);
  const [inspector, setInspector] = useState('');
  const [inspectors, setInspectors] = useState([]);
  const [showInspectorModal, setShowInspectorModal] = useState(false);
  const [newInspectorName, setNewInspectorName] = useState('');
  const [online, setOnline] = useState(true);
  
  // 검수원 로드
  useEffect(() => {
    try {
      const i = localStorage.getItem(INSPECTOR_KEY);
      if (i) setInspector(i);
      else setShowInspectorModal(true);
      const list = localStorage.getItem(INSPECTORS_KEY);
      if (list) setInspectors(JSON.parse(list));
      const a = localStorage.getItem(ACTIVE_KEY);
      if (a) setActiveKey(a);
    } catch (e) {}
  }, []);
  
  // Firebase 실시간 구독
  useEffect(() => {
    const unsubV = fbSubscribeVoyages((data) => {
      // 양하 항차만 필터
      const filtered = {};
      for (const [k, v] of Object.entries(data)) {
        if (v.type === 'discharge') filtered[k] = v;
      }
      setVoyagesAll(filtered);
      setOnline(true);
    });
    const unsubC = fbSubscribeAllCompleted((data) => setCompletedAll(data));
    return () => { unsubV(); unsubC(); };
  }, []);
  
  // 활성 항차의 X-RAY 구독
  useEffect(() => {
    if (!activeKey) return;
    const unsubX = fbSubscribeXray(activeKey, (data) => setXrayList(data));
    const unsubXs = fbSubscribeXraySeals(activeKey, (data) => setXraySeals(data));
    return () => { unsubX(); unsubXs(); };
  }, [activeKey]);
  
  const saveInspector = (name) => {
    setInspector(name);
    localStorage.setItem(INSPECTOR_KEY, name);
    if (!inspectors.includes(name)) {
      const next = [...inspectors, name];
      setInspectors(next);
      localStorage.setItem(INSPECTORS_KEY, JSON.stringify(next));
    }
  };
  const saveActive = (k) => {
    setActiveKey(k);
    if (k) localStorage.setItem(ACTIVE_KEY, k);
    else localStorage.removeItem(ACTIVE_KEY);
  };
  
  const current = activeKey ? voyagesAll[activeKey] : null;
  const ediContainers = current?.ediContainers || [];
  const dischargeRecords = current?.dischargeRecords || [];
  const dischargeCns = useMemo(() => new Set(dischargeRecords.map(r => r.cn)), [dischargeRecords]);
  const completedMap = completedAll[activeKey] || {};
  
  const dischargeList = useMemo(() => {
    if (dischargeRecords.length === 0) return [];
    const ediByCn = {};
    for (const c of ediContainers) ediByCn[c.cn] = c;
    return dischargeRecords.map(r => {
      const edi = ediByCn[r.cn];
      if (edi) return { ...edi, sl: r.sl || edi.sl, bl: r.bl || edi.bl, wt: r.wt || edi.wt, _matched: true };
      return { ...r, _matched: false };
    });
  }, [dischargeRecords, ediContainers]);
  
  const searchResults = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toUpperCase().replace(/\s+/g, '');
    const isFourDigit = /^\d{4}$/.test(q);
    const matchFn = (c) => {
      const cn = (c.cn || '').toUpperCase();
      if (isFourDigit) return cn.endsWith(q);
      return cn.includes(q) || (c.sl || '').toUpperCase().includes(q) || (c.bl || '').toUpperCase().includes(q);
    };
    return ediContainers.filter(matchFn).slice(0, 50);
  }, [query, ediContainers]);
  
  const completeContainer = async (cn, damaged = false) => {
    if (!activeKey || !inspector) {
      alert('검수원을 먼저 선택하세요');
      setShowInspectorModal(true);
      return;
    }
    try {
      await fbCompleteContainer(activeKey, cn, { by: inspector, damaged, side: 'discharge' });
      setQuery('');
      setSelectedCn(null);
    } catch (e) {
      alert('Firebase 저장 실패: ' + e.message);
      setOnline(false);
    }
  };
  const cancelComplete = async (cn) => {
    if (!activeKey) return;
    try { await fbCancelComplete(activeKey, cn); } catch (e) { alert('실패: ' + e.message); }
  };
  const toggleXray = async (cn) => {
    if (!activeKey) return;
    try { await fbToggleXray(activeKey, cn, !xrayList[cn]); } catch (e) { alert('실패: ' + e.message); }
  };
  const setXraySeal = async (cn, seal, eseal) => {
    if (!activeKey) return;
    try { await fbSetXraySeal(activeKey, cn, seal, eseal); } catch (e) { alert('실패: ' + e.message); }
  };
  
  const addVoyage = async (vsl, voy, ediContainers, etd = '', pol = '') => {
    const key = makeVoyageKey(vsl, voy, 'discharge');
    try {
      await fbAddVoyage(key, {
        vsl, voy, etd, pol, type: 'discharge',
        ediContainers, dischargeRecords: [],
      });
      saveActive(key);
      return key;
    } catch (e) { alert('등록 실패: ' + e.message); }
  };
  const applyDischargeList = async (key, records) => {
    try { await fbUpdateVoyage(key, { dischargeRecords: records }); }
    catch (e) { alert('실패: ' + e.message); }
  };
  const deleteVoyage = async (key) => {
    if (!confirm(`항차 "${voyagesAll[key]?.vsl} ${voyagesAll[key]?.voy}" 를 Firebase 에서 삭제하시겠습니까?\n\n⚠ 모든 검수원의 데이터가 삭제됩니다`)) return;
    try {
      await fbDeleteVoyage(key);
      if (activeKey === key) saveActive(null);
    } catch (e) { alert('실패: ' + e.message); }
  };
  
  const isCompleted = (cn) => !!completedMap[cn];
  const completedInfo = (cn) => completedMap[cn];
  
  const selected = selectedCn ? ediContainers.find(c => c.cn === selectedCn) || dischargeList.find(c => c.cn === selectedCn) : null;
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* 검수원 선택 모달 */}
      {showInspectorModal && (
        <InspectorModal
          inspectors={inspectors}
          current={inspector}
          onSelect={(name) => { saveInspector(name); setShowInspectorModal(false); }}
          onAdd={(name) => { saveInspector(name); setNewInspectorName(''); setShowInspectorModal(false); }}
          newName={newInspectorName}
          setNewName={setNewInspectorName}
          onClose={() => inspector && setShowInspectorModal(false)}
        />
      )}
      
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowDownToLine className="w-5 h-5 text-blue-400 flex-shrink-0"/>
            <div className="min-w-0">
              <div className="font-bold text-sm sm:text-base text-blue-200 truncate">양하 검수</div>
              <div className="text-[10px] text-slate-500 truncate">
                {current ? `${current.vsl} ${current.voy}` : '항차 없음'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {online ? <Cloud className="w-3.5 h-3.5 text-emerald-400" title="실시간 연결됨"/> : <CloudOff className="w-3.5 h-3.5 text-red-400" title="오프라인"/>}
            <button onClick={() => setShowInspectorModal(true)}
              className="bg-amber-900/40 border border-amber-700/40 px-2 py-1 rounded text-xs flex items-center gap-1">
              <span className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-slate-900 text-[10px] font-black">{inspector[0] || '?'}</span>
              <span className="font-bold text-amber-200 max-w-[60px] truncate">{inspector || '검수원'}</span>
              <RefreshCw className="w-3 h-3 text-amber-400"/>
            </button>
          </div>
        </div>
      </header>
      
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-[52px] z-30">
        <div className="max-w-7xl mx-auto px-1 flex gap-0.5 overflow-x-auto">
          {[
            { k: 'list', t: '양하리스트', i: ArrowDownToLine },
            { k: 'bay', t: '베이플랜', i: MapPin },
            { k: 'search', t: '검색', i: Search },
            { k: 'voyage', t: '항차관리', i: Upload },
          ].map(({k, t, i: Icon}) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
                tab === k ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400'
              }`}>
              <Icon className="w-4 h-4"/>{t}
            </button>
          ))}
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-3 py-4">
        {!current && tab !== 'voyage' && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-6 text-center">
            <Upload className="w-10 h-10 mx-auto mb-2 text-amber-400/60"/>
            <div className="text-amber-200 font-bold mb-1">활성 항차가 없습니다</div>
            <button onClick={() => setTab('voyage')} className="mt-3 bg-amber-500 hover:bg-amber-400 text-slate-900 px-4 py-2 rounded font-bold text-sm">
              항차 관리로
            </button>
          </div>
        )}
        {current && tab === 'list' && <DischargeListTab list={dischargeList} setSelectedCn={setSelectedCn} xrayList={xrayList} completedMap={completedMap} toggleXray={toggleXray}/>}
        {current && tab === 'bay' && <BayTab ediContainers={ediContainers} dischargeCns={dischargeCns} xrayList={xrayList} setSelectedCn={setSelectedCn} completedMap={completedMap}/>}
        {tab === 'search' && <SearchTab query={query} setQuery={setQuery} results={searchResults} xrayList={xrayList} dischargeCns={dischargeCns} setSelectedCn={setSelectedCn}/>}
        {tab === 'voyage' && <VoyageTab voyages={voyagesAll} activeKey={activeKey} setActiveKey={saveActive} addVoyage={addVoyage} deleteVoyage={deleteVoyage} applyDischargeList={applyDischargeList} addXrayBulk={(cnList) => fbAddXrayBulk(activeKey, cnList)}/>}
      </main>
      
      {selected && <DetailModal 
        c={selected}
        isDischarge={dischargeCns.has(selected.cn)}
        xrayMarked={!!xrayList[selected.cn]}
        toggleXray={() => toggleXray(selected.cn)}
        completed={isCompleted(selected.cn)}
        completedInfo={completedInfo(selected.cn)}
        onComplete={(d) => completeContainer(selected.cn, d)}
        onCancelComplete={() => cancelComplete(selected.cn)}
        xraySeal={xraySeals[selected.cn] || { seal: '', eseal: '' }}
        onSetXraySeal={(s, e) => setXraySeal(selected.cn, s, e)}
        onClose={() => setSelectedCn(null)}/>}
      
      <footer className="border-t border-slate-800 mt-8 py-3 text-center text-[10px] text-slate-500">
        양하 검수앱 · ☁ Firebase 실시간 동기화 · 개발자: <span className="text-amber-400">연지아빠</span>
      </footer>
    </div>
  );
}

function InspectorModal({ inspectors, current, onSelect, onAdd, newName, setNewName, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="text-xl font-bold text-amber-300 flex items-center gap-2">
          <User className="w-5 h-5"/>
          검수원 선택 / 교대
        </div>
        <div className="text-xs text-slate-400 bg-slate-800/50 p-2.5 rounded">
          💡 이 시점부터 모든 완료 처리는 선택된 검수원으로 기록됩니다 (실시간 Firebase 저장)
        </div>
        
        <div>
          <div className="text-xs text-amber-300 font-bold mb-1.5">+ 새 검수원</div>
          <div className="flex gap-2">
            <input type="text" value={newName} 
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newName.trim() && onAdd(newName.trim())}
              placeholder="이름 입력"
              autoFocus
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"/>
            <button onClick={() => newName.trim() && onAdd(newName.trim())}
              disabled={!newName.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-slate-900 rounded font-bold text-sm">
              시작
            </button>
          </div>
        </div>
        
        {inspectors.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 font-bold mb-1.5">기존 검수원</div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {inspectors.map(name => (
                <button key={name} onClick={() => onSelect(name)}
                  className={`w-full px-3 py-2.5 rounded text-left flex items-center gap-2 ${
                    name === current ? 'bg-amber-500/20 border border-amber-500 text-amber-200' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${
                    name === current ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {name[0]}
                  </div>
                  <div className="flex-1 mono font-bold">{name}</div>
                  {name === current && <span className="text-[10px] text-amber-300">현재</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DischargeListTab({ list, setSelectedCn, xrayList, completedMap, toggleXray }) {
  const [filter, setFilter] = useState('all');
  const total = list.length;
  const completedCount = list.filter(c => completedMap[c.cn]).length;
  const damagedCount = list.filter(c => completedMap[c.cn]?.damaged).length;
  const remaining = total - completedCount;
  const filtered = list.filter(c => {
    const info = completedMap[c.cn];
    if (filter === 'completed') return !!info;
    if (filter === 'remaining') return !info;
    if (filter === 'damaged') return info?.damaged;
    return true;
  });
  
  if (list.length === 0) {
    return <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-500">
      <ArrowDownToLine className="w-12 h-12 mx-auto mb-3 opacity-30"/>
      양하 리스트가 없습니다.<br/>
      <span className="text-xs">항차관리에서 양하 리스트(엑셀)을 업로드하세요.</span>
    </div>;
  }
  
  return <div className="space-y-3">
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center gap-2">
      <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'all' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>총 {total}대</button>
      <button onClick={() => setFilter('completed')} className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'completed' ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-emerald-300'}`}>✓ 완료 {completedCount}</button>
      <button onClick={() => setFilter('remaining')} className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'remaining' ? 'bg-blue-500 text-slate-900' : 'bg-slate-800 text-blue-300'}`}>잔여 {remaining}</button>
      {damagedCount > 0 && <button onClick={() => setFilter('damaged')} className={`px-3 py-1.5 rounded text-xs font-bold ${filter === 'damaged' ? 'bg-orange-500 text-slate-900' : 'bg-slate-800 text-orange-300'}`}>⚠ 데미지 {damagedCount}</button>}
      <div className="ml-auto text-xs text-amber-300 font-bold">{total > 0 ? Math.round((completedCount / total) * 100) : 0}%</div>
    </div>
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-800">
      {filtered.map((c, i) => {
        const info = completedMap[c.cn]; const isComp = !!info; const isDmg = info?.damaged;
        return <div key={c.cn + i} onClick={() => setSelectedCn(c.cn)}
          className={`px-3 py-2.5 flex items-center gap-2.5 cursor-pointer ${isDmg ? 'bg-orange-950/40' : isComp ? 'bg-emerald-950/30 opacity-60' : ''}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isDmg && <span className="text-orange-300">⚠</span>}
              {isComp && !isDmg && <span className="text-emerald-400">✓</span>}
              <span className="mono font-black text-sm text-blue-200">{c.cn}</span>
              <span className={`text-[9px] mono px-1 py-0.5 rounded font-bold ${c.fe === 'F' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{c.fe || 'F'}</span>
              {c.dg && <span className="text-red-400 text-xs">🔥</span>}
              {c.rf && <span className="text-cyan-400 text-xs">❄</span>}
              {c.tk && <span className="text-orange-400 text-xs">⬛</span>}
            </div>
            {c.sl && <div className="text-[10px] mono text-amber-200 mt-0.5">실 {c.sl}</div>}
            <div className="flex items-center gap-2 mt-1 text-[10px] mono flex-wrap text-slate-400">
              {c.bay && <span className="text-amber-200 font-bold">{fmtPos(c)}</span>}
              {c.iso && <span>{isoToLabel(c.iso)}</span>}
              {c.wt > 0 && <span>{formatWt(c.wt)}</span>}
              {isComp && info?.by && <span className="text-emerald-300">[{info.by}]</span>}
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); toggleXray(c.cn); }}
            className={`w-9 h-9 rounded text-sm font-bold mono flex-shrink-0 ${xrayList[c.cn] ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-500'}`}>
            {xrayList[c.cn] ? '✓' : 'X'}
          </button>
        </div>;
      })}
      {filtered.length === 0 && <div className="p-8 text-center text-slate-500 text-sm">데이터 없음</div>}
    </div>
  </div>;
}

function BayTab({ ediContainers, dischargeCns, xrayList, setSelectedCn, completedMap }) {
  const [pageIdx, setPageIdx] = useState(0);
  const scrollRef = useRef(null);
  const completed = completedMap;
  
  // 마우스 드래그 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let isDown = false, startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;
    const onMouseDown = (e) => {
      // 셀 클릭 (button) 은 무시
      if (e.target.closest('button')) return;
      isDown = true;
      startX = e.pageX - el.offsetLeft;
      startY = e.pageY - el.offsetTop;
      scrollLeft = el.scrollLeft;
      scrollTop = el.scrollTop;
      el.style.cursor = 'grabbing';
    };
    const onMouseUp = () => {
      isDown = false;
      el.style.cursor = 'grab';
    };
    const onMouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const y = e.pageY - el.offsetTop;
      el.scrollLeft = scrollLeft - (x - startX);
      el.scrollTop = scrollTop - (y - startY);
    };
    // 마우스 휠 좌우 스크롤 (shift 안 눌러도 가능)
    const onWheel = (e) => {
      // 가로 우선 — deltaY 가 크면 좌우로 변환
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, [pageIdx]);
  
  // 시프팅 감지
  const shiftingMap = useMemo(() => {
    const result = { needsShift: {}, shiftCns: {} };
    if (!dischargeCns || dischargeCns.size === 0) return result;
    
    const tierZone = (t) => parseInt(t) >= 80 ? 'deck' : 'hold';
    
    for (const c of ediContainers) {
      if (!dischargeCns.has(c.cn)) continue;
      if (!c.bay || !c.tier) continue;
      const zone = tierZone(c.tier);
      const tier = parseInt(c.tier);
      
      const above = ediContainers.filter(o => 
        o.cn !== c.cn &&
        !dischargeCns.has(o.cn) && // 양하 아닌 것
        o.bay === c.bay && o.row === c.row &&
        o.tier && tierZone(o.tier) === zone &&
        parseInt(o.tier) > tier
      );
      
      if (above.length > 0) {
        result.needsShift[c.cn] = above.length;
        for (const a of above) result.shiftCns[a.cn] = true;
      }
    }
    return result;
  }, [ediContainers, dischargeCns]);
  
  // 베이별 그룹
  const bayGroups = useMemo(() => {
    const g = {};
    for (const c of ediContainers) {
      if (!c.bay) continue;
      if (!g[c.bay]) g[c.bay] = [];
      g[c.bay].push(c);
    }
    return g;
  }, [ediContainers]);
  
  // 페어드 페이지 (홀수+짝수)
  const pages = useMemo(() => {
    const bays = Object.keys(bayGroups).sort();
    const out = [];
    const used = new Set();
    for (const b of bays) {
      if (used.has(b)) continue;
      const num = parseInt(b);
      if (num % 2 === 1) {
        const next = String(num + 1).padStart(3, '0');
        if (bays.includes(next)) {
          out.push({ title: `${b}/${next}`, bays: [b, next] });
          used.add(b); used.add(next);
        } else {
          out.push({ title: b, bays: [b] });
          used.add(b);
        }
      } else {
        out.push({ title: b, bays: [b] });
        used.add(b);
      }
    }
    return out;
  }, [bayGroups]);
  
  if (pages.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-12 text-center text-slate-500">
        <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30"/>
        베이 데이터가 없습니다
      </div>
    );
  }
  
  const safeIdx = Math.min(pageIdx, pages.length - 1);
  const currentPage = pages[safeIdx];
  
  // 셀 색깔
  const cellColor = (c) => {
    // 완료된 거 — 흐리게
    if (completed[c.cn]) {
      return completed[c.cn].damaged
        ? 'bg-orange-900/40 text-orange-200 border-orange-700/60 opacity-50'
        : 'bg-emerald-900/40 text-emerald-200 border-emerald-700/60 opacity-50';
    }
    // X-RAY — 노랑
    if (xrayList[c.cn]) {
      return 'bg-amber-500 text-slate-900 border-amber-300 ring-2 ring-amber-300';
    }
    // 시프팅 대상 — 황색
    if (shiftingMap.shiftCns[c.cn]) {
      return 'bg-amber-600 text-amber-50 border-amber-400 ring-1 ring-amber-300';
    }
    // 평택 양하 — 빨강
    if (dischargeCns.has(c.cn)) {
      return 'bg-red-600 text-red-50 border-red-300 ring-1 ring-red-300';
    }
    // 특수
    if (c.dg) return 'bg-red-900/40 text-red-300 border-red-800/50';
    if (c.rf) return 'bg-cyan-900/40 text-cyan-300 border-cyan-800/50';
    if (c.tk) return 'bg-orange-900/40 text-orange-300 border-orange-800/50';
    // 통과 — 회색
    return 'bg-slate-700/60 text-slate-400 border-slate-600/50';
  };
  
  // 통계
  const ptkCount = ediContainers.filter(c => dischargeCns.has(c.cn)).length;
  const shiftCount = Object.keys(shiftingMap.needsShift).length;
  const shiftTargetCount = Object.keys(shiftingMap.shiftCns).length;
  
  // BAY 선택 (우측 목록)
  const allBays = Object.keys(bayGroups).sort();
  
  // 현재 페이지의 컨테이너
  const containers = currentPage.bays.flatMap(b => bayGroups[b] || []);
  
  // ROW/TIER 그리드
  const rows = useMemo(() => {
    const rs = new Set(containers.map(c => c.row));
    return Array.from(rs).sort();
  }, [containers]);
  const deckTiers = useMemo(() => {
    const ts = new Set(containers.filter(c => parseInt(c.tier) >= 80).map(c => c.tier));
    return Array.from(ts).sort((a, b) => parseInt(b) - parseInt(a));
  }, [containers]);
  const holdTiers = useMemo(() => {
    const ts = new Set(containers.filter(c => parseInt(c.tier) < 80).map(c => c.tier));
    return Array.from(ts).sort((a, b) => parseInt(b) - parseInt(a));
  }, [containers]);
  
  const getCell = (bay, row, tier) => {
    return containers.find(c => c.bay === bay && c.row === row && c.tier === tier);
  };
  
  const renderCell = (bay, row, tier) => {
    const c = getCell(bay, row, tier);
    if (!c) {
      return <div key={`${bay}-${row}-${tier}`} className="w-[44px] sm:w-[64px] lg:w-[88px] h-12 sm:h-14 border border-dashed border-slate-800 rounded flex-shrink-0"/>;
    }
    const sm = shiftingMap;
    const needsShift = sm.needsShift[c.cn];
    const isShiftTarget = sm.shiftCns[c.cn];
    
    return (
      <button key={`${bay}-${row}-${tier}`} onClick={() => setSelectedCn(c.cn)}
        className={`relative border-2 rounded mono text-[8.5px] sm:text-[10px] font-bold px-0.5 py-1 w-[44px] sm:w-[64px] lg:w-[88px] h-12 sm:h-14 flex-shrink-0 hover:brightness-125 active:scale-95 transition flex flex-col justify-center items-center ${cellColor(c)}`}
        title={`${c.cn} | BAY ${c.bay} ROW ${c.row} TIER ${c.tier} | ${c.tp || c.iso} ${c.fe} | ${formatWt(c.wt)}`}>
        {needsShift && (
          <div className="absolute top-0 left-0 text-[10px] leading-none bg-amber-400 text-slate-900 rounded-br px-0.5 font-black">
            ⬆{needsShift}
          </div>
        )}
        {isShiftTarget && (
          <div className="absolute top-0 left-0 text-[10px] leading-none bg-amber-300 text-slate-900 rounded-br px-0.5 font-black">
            🔄
          </div>
        )}
        {(c.dg || c.rf || c.tk) && (
          <div className="absolute top-0 right-0 text-[8px] leading-none">
            {c.dg && '🔥'}
            {c.rf && '❄'}
            {c.tk && '⬛'}
          </div>
        )}
        <div className="w-full text-center whitespace-nowrap overflow-hidden text-ellipsis">
          <span className="sm:hidden">{c.cn ? c.cn.slice(-4) : ''}</span>
          <span className="hidden sm:inline lg:hidden">{c.cn ? c.cn.slice(-7) : ''}</span>
          <span className="hidden lg:inline">{c.cn || ''}</span>
        </div>
        <div className="text-[7px] sm:text-[8px] opacity-90 mt-0.5">
          <span>{c.fe || 'F'}</span>
          <span className="ml-0.5">{isoToLabel(c.iso)}</span>
        </div>
      </button>
    );
  };
  
  return (
    <div className="space-y-3">
      {/* 정보 배너 */}
      <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <div className="font-bold flex items-center gap-1.5 text-blue-200">
            <ArrowDownToLine className="w-4 h-4 text-blue-400"/>양하 베이 {currentPage.title}
            <span className="text-[10px] text-slate-500 ml-1">({safeIdx + 1}/{pages.length})</span>
          </div>
          <span className="text-slate-400">강조: <span className="font-bold mono text-red-300">평택 양하 {ptkCount}</span></span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">전체: <span className="mono">{ediContainers.length}</span></span>
          {shiftCount > 0 && (
            <>
              <span className="text-slate-500">|</span>
              <span className="bg-amber-900/40 border border-amber-600/50 text-amber-200 px-2 py-1 rounded text-xs font-bold">
                ⚠ 시프팅: 양하 {shiftCount} (위 {shiftTargetCount})
              </span>
            </>
          )}
        </div>
      </div>
      
      {/* 헤더 + 범례 + 페이지 버튼 */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1.5 text-[10px] sm:text-xs flex-wrap items-center">
            <Legend color="bg-red-600" label="평택 양하"/>
            <Legend color="bg-amber-600" label="시프팅"/>
            <Legend color="bg-amber-500" label="X-RAY"/>
            <Legend color="bg-slate-600" label="통과"/>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setPageIdx(Math.max(0, safeIdx - 1))} disabled={safeIdx === 0}
              className="w-9 h-9 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center disabled:opacity-30">
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <button onClick={() => setPageIdx(Math.min(pages.length - 1, safeIdx + 1))} disabled={safeIdx === pages.length - 1}
              className="w-9 h-9 bg-slate-800 hover:bg-slate-700 rounded flex items-center justify-center disabled:opacity-30">
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex gap-2">
        {/* 베이 플랜 영역 */}
        <div ref={scrollRef}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-3 overflow-x-auto overscroll-x-contain"
          style={{ touchAction: 'pan-x pan-y' }}>
          {deckTiers.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] text-slate-500 mb-1">⬆ DECK (갑판 위)</div>
              {deckTiers.map(tier => (
                <div key={tier} className="flex gap-1 mb-1">
                  <div className="w-6 text-[9px] text-slate-500 mono flex items-center justify-center">{tier}</div>
                  {currentPage.bays.map(bay => 
                    rows.map(row => renderCell(bay, row, tier))
                  )}
                </div>
              ))}
            </div>
          )}
          
          {holdTiers.length > 0 && (
            <div className="mt-2 pt-2 border-t-2 border-slate-700">
              <div className="text-[10px] text-slate-500 mb-1">⬇ HOLD (선창 안)</div>
              {holdTiers.map(tier => (
                <div key={tier} className="flex gap-1 mb-1">
                  <div className="w-6 text-[9px] text-slate-500 mono flex items-center justify-center">{tier}</div>
                  {currentPage.bays.map(bay => 
                    rows.map(row => renderCell(bay, row, tier))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 우측 BAY 목록 */}
        <div className="hidden md:block w-20 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg p-2 overflow-y-auto sticky top-24" style={{ maxHeight: '70vh' }}>
          <div className="text-[9px] text-slate-500 mb-1 text-center">BAY</div>
          <div className="space-y-1">
            {pages.map((p, i) => (
              <button key={i} onClick={() => setPageIdx(i)}
                className={`w-full px-1 py-1 rounded text-[10px] mono font-bold transition ${
                  i === safeIdx ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}>
                {p.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function SearchTab({ query, setQuery, results, xrayList, dischargeCns, setSelectedCn }) {
  return <div className="space-y-3">
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"/>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="컨테이너 / 끝 4자리 / 실 / B/L" className="w-full pl-9 pr-9 py-2.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
        {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded hover:bg-slate-700 flex items-center justify-center"><X className="w-4 h-4"/></button>}
      </div>
      <div className="text-[10px] text-slate-500 mt-1.5">{query.length < 2 ? '2자 이상 입력. 4자리는 끝자리 매칭.' : `${results.length}개 결과`}</div>
    </div>
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-800">
      {results.map((c, i) => {
        const isPtk = dischargeCns.has(c.cn);
        return <div key={c.cn + i} onClick={() => setSelectedCn(c.cn)} className={`px-3 py-2.5 cursor-pointer hover:bg-slate-800/50 ${isPtk ? 'bg-red-950/20' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {isPtk && <span className="text-red-300 text-xs font-bold">[양하]</span>}
            <span className="mono font-black text-sm">{c.cn}</span>
            <span className={`text-[10px] mono px-1.5 py-0.5 rounded font-bold ${c.fe === 'F' ? 'bg-emerald-900 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{c.fe}</span>
            {c.dg && <span className="text-red-400">🔥</span>}{c.rf && <span className="text-cyan-400">❄</span>}{c.tk && <span className="text-orange-400">⬛</span>}
            {xrayList[c.cn] && <span className="bg-amber-500 text-slate-900 text-[9px] px-1 rounded font-bold">X-RAY</span>}
          </div>
          <div className="text-[11px] text-slate-400 mono mt-0.5">{c.bay && `${fmtPos(c)} · `}{isoToLabel(c.iso)}{c.pol && ` · POL ${c.pol}`}{c.sl && ` · 실 ${c.sl}`}</div>
        </div>;
      })}
      {query.length >= 2 && results.length === 0 && <div className="p-8 text-center text-slate-500 text-sm">결과 없음</div>}
    </div>
  </div>;
}

function VoyageTab({ voyages, activeKey, setActiveKey, addVoyage, deleteVoyage, applyDischargeList, addXrayBulk }) {
  const [ediStatus, setEdiStatus] = useState(null);
  const [dischargeStatus, setDischargeStatus] = useState(null);
  const [xrayStatus, setXrayStatus] = useState(null);
  const ediRef = useRef(null); const dischargeRef = useRef(null); const xrayRef = useRef(null);
  
  const handleEdi = async (file) => {
    if (!file) return;
    setEdiStatus({ loading: true, msg: `파싱 중: ${file.name}` });
    try {
      const text = await file.text();
      // ASC 자동 감지 ($604 헤더)
      let r;
      let fileType = 'EDI';
      if (text.startsWith('$604') || text.substring(0, 200).includes('$604')) {
        r = parseAscFile(text);
        fileType = 'ASC';
      } else {
        r = parseBAPLIE(text);
      }
      if (r.containers.length === 0) { setEdiStatus({ ok: false, msg: `${fileType} 컨테이너 없음` }); return; }
      await addVoyage(r.vsl || file.name.replace(/\.[^.]+$/, ''), r.voy || '0000', r.containers, r.etd || '', r.pol || '');
      setEdiStatus({ ok: true, msg: `[${fileType}] ${r.vsl} ${r.voy} — ${r.containers.length}대 (Firebase 등록)` });
    } catch (e) { setEdiStatus({ ok: false, msg: '실패: ' + e.message }); }
    if (ediRef.current) ediRef.current.value = '';
  };
  const handleDischarge = async (file) => {
    if (!file || !activeKey) return;
    setDischargeStatus({ loading: true, msg: `파싱 중: ${file.name}` });
    try {
      const buf = await file.arrayBuffer();
      const { records } = await parseListExcel(buf);
      if (records.length === 0) { setDischargeStatus({ ok: false, msg: '없음' }); return; }
      await applyDischargeList(activeKey, records);
      setDischargeStatus({ ok: true, msg: `${records.length}대 양하 등록` });
    } catch (e) { setDischargeStatus({ ok: false, msg: '실패: ' + e.message }); }
    if (dischargeRef.current) dischargeRef.current.value = '';
  };
  const handleXray = async (file) => {
    if (!file || !activeKey) return;
    setXrayStatus({ loading: true, msg: `파싱 중: ${file.name}` });
    try {
      const buf = await file.arrayBuffer();
      const { containers } = await parseXrayList(buf);
      await addXrayBulk(containers);
      setXrayStatus({ ok: true, msg: `${containers.length}개 X-RAY 추가` });
    } catch (e) { setXrayStatus({ ok: false, msg: '실패: ' + e.message }); }
    if (xrayRef.current) xrayRef.current.value = '';
  };
  
  return <div className="space-y-4">
    <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 flex items-start gap-2">
      <Cloud className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"/>
      <div className="text-xs text-blue-200/80">
        ☁ Firebase 실시간 동기화. 모든 검수원이 같은 항차 데이터를 공유합니다.
      </div>
    </div>
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
      <div className="font-bold text-blue-200 text-sm">1. 양하 자료 (ASC / EDI / TXT 자동 인식)</div>
      <input ref={ediRef} type="file" accept=".edi,.EDI,.txt,.TXT,.asc,.ASC" onChange={e => handleEdi(e.target.files?.[0])} className="block w-full text-xs text-slate-300 mono file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-blue-500 file:text-slate-900 cursor-pointer"/>
      {ediStatus && <div className={`text-xs px-2 py-1.5 rounded mono ${ediStatus.ok ? 'bg-emerald-900/40 text-emerald-200' : ediStatus.loading ? 'bg-slate-800 text-slate-300' : 'bg-red-900/40 text-red-200'}`}>{ediStatus.msg}</div>}
    </div>
    {activeKey && <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
      <div className="font-bold text-amber-200 text-sm">2. 양하 리스트 (Excel)</div>
      <input ref={dischargeRef} type="file" accept=".xlsx,.xls,.XLSX,.XLS,.csv,.CSV" onChange={e => handleDischarge(e.target.files?.[0])} className="block w-full text-xs text-slate-300 mono file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-amber-500 file:text-slate-900 cursor-pointer"/>
      {dischargeStatus && <div className={`text-xs px-2 py-1.5 rounded mono ${dischargeStatus.ok ? 'bg-emerald-900/40 text-emerald-200' : dischargeStatus.loading ? 'bg-slate-800 text-slate-300' : 'bg-red-900/40 text-red-200'}`}>{dischargeStatus.msg}</div>}
    </div>}
    {activeKey && <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
      <div className="font-bold text-red-200 text-sm">3. X-RAY 리스트 (Excel)</div>
      <input ref={xrayRef} type="file" accept=".xlsx,.xls,.XLSX,.XLS,.csv,.CSV" onChange={e => handleXray(e.target.files?.[0])} className="block w-full text-xs text-slate-300 mono file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-bold file:bg-red-500 file:text-slate-900 cursor-pointer"/>
      {xrayStatus && <div className={`text-xs px-2 py-1.5 rounded mono ${xrayStatus.ok ? 'bg-emerald-900/40 text-emerald-200' : xrayStatus.loading ? 'bg-slate-800 text-slate-300' : 'bg-red-900/40 text-red-200'}`}>{xrayStatus.msg}</div>}
    </div>}
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="font-bold text-sm mb-3">항차 목록 ({Object.keys(voyages).length}개) <span className="text-[10px] text-emerald-400">☁ Firebase</span></div>
      {Object.keys(voyages).length === 0 ? <div className="text-center text-slate-500 text-sm py-6">등록된 항차 없음</div> : <div className="space-y-1.5">{Object.values(voyages).map(v => <div key={v.key || v.vsl + v.voy} className={`p-2.5 rounded border flex items-center gap-2 ${(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge')) === activeKey ? 'bg-amber-900/20 border-amber-600' : 'bg-slate-800/40 border-slate-700'}`}>
        <button onClick={() => setActiveKey(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge'))} className="flex-1 text-left">
          <div className="font-bold text-sm">{v.vsl} <span className="mono text-amber-300">{v.voy}</span></div>
          <div className="text-[10px] text-slate-400 mono">EDI {v.ediContainers?.length || 0} · 양하 {v.dischargeRecords?.length || 0}</div>
        </button>
        <button onClick={() => deleteVoyage(v.key || makeVoyageKey(v.vsl, v.voy, 'discharge'))} className="w-8 h-8 bg-red-900/40 hover:bg-red-900/60 rounded text-red-300 flex items-center justify-center"><Trash2 className="w-4 h-4"/></button>
      </div>)}</div>}
    </div>
  </div>;
}

function DetailModal({ c, isDischarge, xrayMarked, toggleXray, completed, completedInfo, onComplete, onCancelComplete, xraySeal, onSetXraySeal, onClose }) {
  const [seal, setSeal] = useState(xraySeal.seal || '');
  const [eseal, setEseal] = useState(xraySeal.eseal || '');
  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
    <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-md w-full p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isDischarge && <div className="text-[10px] text-red-300 font-bold mb-0.5">[평택 양하]</div>}
          <div className="mono font-black text-xl text-amber-200">{c.cn}</div>
          <div className="text-xs text-slate-400 mt-1">{c.bay && <>{fmtPos(c)} · </>}{isoToLabel(c.iso)} · {c.fe || 'F'}{c.wt > 0 && <> · {formatWt(c.wt)}</>}</div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center"><X className="w-4 h-4"/></button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-800/50 rounded p-2.5">
        {c.pol && <div><span className="text-slate-400">POL:</span> <span className="mono font-bold">{c.pol}</span></div>}
        {c.pod && <div><span className="text-slate-400">POD:</span> <span className="mono font-bold">{c.pod}</span></div>}
        {c.sl && <div className="col-span-2"><span className="text-slate-400">실:</span> <span className="mono font-bold text-amber-200">{c.sl}</span></div>}
        {c.bl && <div className="col-span-2"><span className="text-slate-400">B/L:</span> <span className="mono">{c.bl}</span></div>}
        {c.op && <div><span className="text-slate-400">선사:</span> {c.op}</div>}
        {c.tmp && <div><span className="text-slate-400">온도:</span> <span className="text-cyan-300 font-bold">{c.tmp}°C</span></div>}
      </div>
      {(c.dg || c.rf || c.tk || c.oog) && <div className="flex flex-wrap gap-1 text-xs">
        {c.dg && <span className="bg-red-900/60 text-red-200 px-2 py-1 rounded font-bold">🔥 DG {c.un && `UN${c.un}`}</span>}
        {c.rf && <span className="bg-cyan-900/60 text-cyan-200 px-2 py-1 rounded font-bold">❄ REEFER {c.tmp && `${c.tmp}°C`}</span>}
        {c.tk && <span className="bg-orange-900/60 text-orange-200 px-2 py-1 rounded font-bold">⬛ TANK</span>}
        {c.oog && <span className="bg-purple-900/60 text-purple-200 px-2 py-1 rounded font-bold">📐 OOG</span>}
      </div>}
      <div className="space-y-2">
        <button onClick={toggleXray} className={`w-full py-2 rounded font-bold text-sm ${xrayMarked ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>{xrayMarked ? '✓ X-RAY 대상' : 'X-RAY 표시'}</button>
        {xrayMarked && <div className="bg-amber-900/20 border border-amber-700/40 rounded p-2.5 space-y-2">
          <div className="text-[10px] text-amber-200 font-bold">실 / E-SEAL</div>
          <input value={seal} onChange={e => setSeal(e.target.value)} onBlur={() => onSetXraySeal(seal, eseal)} placeholder="실 번호" className="w-full px-2 py-1.5 bg-slate-800 rounded text-xs mono"/>
          <input value={eseal} onChange={e => setEseal(e.target.value)} onBlur={() => onSetXraySeal(seal, eseal)} placeholder="E-SEAL 4자리" className="w-full px-2 py-1.5 bg-slate-800 rounded text-xs mono"/>
        </div>}
      </div>
      {!completed ? <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700">
        <button onClick={() => onComplete(false)} className="px-4 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded font-bold text-sm flex items-center justify-center gap-1.5"><Check className="w-5 h-5"/>정상 완료</button>
        <button onClick={() => onComplete(true)} className="px-4 py-3 bg-orange-500 hover:bg-orange-400 text-slate-900 rounded font-bold text-sm">⚠ 데미지</button>
      </div> : <div className={`pt-2 border-t border-slate-700 rounded p-3 ${completedInfo?.damaged ? 'bg-orange-900/30' : 'bg-emerald-900/30'}`}>
        <div className="flex items-center justify-between">
          <div className={`text-xs font-bold ${completedInfo?.damaged ? 'text-orange-200' : 'text-emerald-200'}`}>{completedInfo?.damaged ? '⚠ 데미지' : '✓ 검수 완료'}{completedInfo?.by && <span className="ml-2 text-slate-300">[{completedInfo.by}]</span>}</div>
          <button onClick={onCancelComplete} className="text-xs px-3 py-1.5 bg-red-900/40 hover:bg-red-800/50 text-red-200 rounded">완료 취소</button>
        </div>
        {completedInfo?.at && <div className="text-[10px] text-slate-400 mono mt-1">{new Date(completedInfo.at).toLocaleString('ko-KR')}</div>}
      </div>}
    </div>
  </div>;
}
