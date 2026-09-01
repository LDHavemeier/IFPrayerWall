(function(){
"use strict";

/* =========================================================
   BRAND / CONSTANTS
========================================================= */
var ADMIN_PASSCODE = "IF-STAFF-26";
var SECONDARY_COLORS = ["#8C3F6A","#03738C","#F2884B","#5ABF7D","#A67B9F","#346173","#0396A6"];
var STATUS_META = {
  new:{ label:"Just shared", color:"var(--teal)" },
  in_process:{ label:"In process", color:"var(--gold)" },
  answered:{ label:"Answered", color:"var(--green)" }
};

/* =========================================================
   TINY UTILITIES
========================================================= */
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function uid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-'+Math.random().toString(36).slice(2)+Date.now().toString(36);
}
function now(){ return Date.now(); }
function initials(name){
  if(!name) return "?";
  var parts = name.trim().split(/\s+/);
  var s = parts[0][0] || "";
  if(parts.length>1) s += parts[parts.length-1][0];
  return s.toUpperCase();
}
function colorForName(name){
  var sum=0; for(var i=0;i<(name||"").length;i++) sum += name.charCodeAt(i);
  return SECONDARY_COLORS[sum % SECONDARY_COLORS.length];
}
function fmtTime(ts){
  if(!ts) return "";
  var d = ts - now();
  var abs = Math.abs(d);
  var min = 60000, hr = 3600000, day = 86400000;
  if(abs < min) return "just now";
  if(abs < hr) return Math.round(abs/min)+"m ago";
  if(abs < day) return Math.round(abs/hr)+"h ago";
  if(abs < day*7) return Math.round(abs/day)+"d ago";
  var dt = new Date(ts);
  return dt.toLocaleDateString(undefined,{month:'short', day:'numeric'});
}
function daysBetween(a,b){ return Math.max(1, Math.round((b-a)/86400000)); }
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ t.classList.remove('show'); }, 2400);
}
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

/* =========================================================
   LOCAL MOCK DB (fallback when the live db capability is
   unavailable — e.g. previewing outside claude.ai). Mirrors
   the subset of the real db API this app uses, so the whole
   prototype still works solo. In a real deployment on
   claude.ai the live shared `db` capability is used instead,
   which is what makes the wall multi-user in the first place.
========================================================= */
function createLocalMockDb(){
  var STORE_KEY = "if_prayerwall_mockdb_v1";
  var store = {};
  try{ store = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }catch(e){ store = {}; }
  var subs = {}; // path -> [callback]
  function persist(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(store)); }catch(e){} }
  function notifyCollection(collPath){
    var list = subs[collPath] || [];
    list.forEach(function(fn){ fn(); });
  }
  function collDocs(collPath){
    var out = [];
    Object.keys(store).forEach(function(p){
      var parts = p.split('/');
      var parentPath = parts.slice(0,-1).join('/');
      if(parentPath === collPath) out.push({id: parts[parts.length-1], data: store[p]});
    });
    return out;
  }
  function makeDocRef(path){
    return {
      id: path.split('/').pop(),
      path: path,
      get: function(){
        var d = store[path];
        return Promise.resolve({ exists: !!d, id: path.split('/').pop(), data: function(){ return d ? JSON.parse(JSON.stringify(d)) : undefined; } });
      },
      set: function(data){ store[path]=JSON.parse(JSON.stringify(data)); persist();
        var parent = path.split('/').slice(0,-1).join('/'); notifyCollection(parent); return Promise.resolve(); },
      update: function(data){
        if(!store[path]) return Promise.reject({code:'invalid_argument', message:'doc missing'});
        Object.assign(store[path], JSON.parse(JSON.stringify(data))); persist();
        var parent = path.split('/').slice(0,-1).join('/'); notifyCollection(parent); return Promise.resolve();
      },
      delete: function(){ delete store[path]; persist();
        var parent = path.split('/').slice(0,-1).join('/'); notifyCollection(parent); return Promise.resolve(); },
      acquire: function(){ return Promise.resolve({acquired:true}); },
      onSnapshot: function(next){
        var fire = function(){ var d = store[path]; next({ exists: !!d, id: path.split('/').pop(), data: function(){ return d?JSON.parse(JSON.stringify(d)):undefined; } }); };
        fire();
        var parent = path.split('/').slice(0,-1).join('/');
        subs[parent] = subs[parent]||[]; subs[parent].push(fire);
        return function(){ subs[parent] = (subs[parent]||[]).filter(function(f){return f!==fire;}); };
      },
      collection: function(sub){ return makeCollRef(path+'/'+sub); }
    };
  }
  function makeCollRef(collPath){
    var filters = [], order=null, lim=null;
    function apply(docs){
      var res = docs.slice();
      filters.forEach(function(f){
        res = res.filter(function(d){
          var v = d.data[f.field];
          if(f.op==='==') return v===f.value;
          if(f.op==='!=') return v!==f.value;
          if(f.op==='array-contains') return Array.isArray(v) && v.indexOf(f.value)>-1;
          return true;
        });
      });
      if(order) res.sort(function(a,b){
        var av=a.data[order.field], bv=b.data[order.field];
        if(av===undefined) return 1; if(bv===undefined) return -1;
        if(av<bv) return order.dir==='desc'?1:-1;
        if(av>bv) return order.dir==='desc'?-1:1;
        return 0;
      });
      if(lim) res = res.slice(0, lim);
      return res;
    }
    var ref = {
      path: collPath,
      where: function(field,op,value){ filters.push({field:field,op:op,value:value}); return ref; },
      orderBy: function(field,dir){ order={field:field,dir:dir||'asc'}; return ref; },
      limit: function(n){ lim=n; return ref; },
      get: function(){
        var docs = apply(collDocs(collPath));
        return Promise.resolve({ docs: docs.map(function(d){ return { id:d.id, data:function(){return JSON.parse(JSON.stringify(d.data));} }; }) });
      },
      onSnapshot: function(next){
        var fire = function(){
          var docs = apply(collDocs(collPath));
          next({ docs: docs.map(function(d){ return { id:d.id, data:function(){return JSON.parse(JSON.stringify(d.data));} }; }) });
        };
        fire();
        subs[collPath] = subs[collPath]||[]; subs[collPath].push(fire);
        return function(){ subs[collPath] = (subs[collPath]||[]).filter(function(f){return f!==fire;}); };
      },
      doc: function(id){ return makeDocRef(collPath+'/'+(id||uid())); },
      add: function(data){ var id = uid(); var d = makeDocRef(collPath+'/'+id); return d.set(data).then(function(){ return d; }); }
    };
    return ref;
  }
  return {
    doc: function(path){ return makeDocRef(path); },
    collection: function(path){ return makeCollRef(path); }
  };
}

/* =========================================================
   APP STATE
========================================================= */
var DB = null;
var S = {
  profile: null,
  teams: [],
  profiles: [],
  prayers: [],
  notes: [],
  settings: { checkinDays: 3 },
  view: 'feed',
  filter: 'all',
  usingMock: false
};
var MCP = null;
async function getMcp(){
  if(MCP) return MCP;
  try{ MCP = await window.claude.use('mcp'); }catch(e){ MCP = null; }
  return MCP;
}

function myUid(){ return localStorage.getItem('if_pw_uid'); }
function teamById(id){ return S.teams.find(function(t){ return t.id===id; }); }
function profileById(id){ return S.profiles.find(function(p){ return p.id===id; }); }

function visibleToUser(p){
  if(!S.profile) return false;
  if(p.urgency==='emergency') return true;
  if(p.requesterId===S.profile.id) return true;
  if(S.profile.role==='admin') return true;
  var team = teamById(p.teamId);
  if(team && team.kind==='all') return true;
  if(team && Array.isArray(team.memberIds) && team.memberIds.indexOf(S.profile.id)>-1) return true;
  return false;
}
function canManage(p){
  if(!S.profile) return false;
  if(S.profile.role==='admin') return true;
  if(p.requesterId===S.profile.id) return true;
  var team = teamById(p.teamId);
  if(team && Array.isArray(team.memberIds) && team.memberIds.indexOf(S.profile.id)>-1) return true;
  return false;
}

/* =========================================================
   BOOT
========================================================= */
async function boot(){
  var real = null;
  try{ real = await window.claude.use('db'); }catch(e){ real = null; }
  if(real){ DB = real; }
  else { DB = createLocalMockDb(); S.usingMock = true; }

  await ensureSeedTeams();

  var existingId = myUid();
  if(existingId){
    try{
      var snap = await DB.doc('profiles/'+existingId).get();
      if(snap.exists){
        S.profile = Object.assign({id: existingId}, snap.data());
        startApp();
        return;
      }
    }catch(e){ /* fall through to sign-in */ }
  }
  renderSignIn();
}

async function ensureSeedTeams(){
  try{
    var snap = await DB.collection('teams').get();
    if(snap.docs.length>0) return;
    var boot = await DB.doc('meta/bootstrap').get();
    if(boot.exists) return;
    if(DB.doc('meta/bootstrap').acquire){
      try{ await DB.doc('meta/bootstrap').acquire({holder:'seed', ttlMs:8000}); }catch(e){}
    }
    var defaults = [
      { id:'pastoral-staff', name:'Pastoral & Staff Team', kind:'pastor', accepting:true,
        description:'Sent directly to our pastor and staff. Kept in the strictest confidence — this is the smallest circle on the wall.' },
      { id:'wed-night', name:'Wednesday Night Prayer Group', kind:'group', accepting:true,
        description:'Our midweek prayer gathering carries these needs into the room on Wednesday night.' },
      { id:'congregation', name:'Congregation-Wide', kind:'all', accepting:true,
        description:'Shared with the whole Indianola First family here on the wall.' }
    ];
    for(var i=0;i<defaults.length;i++){
      var t = defaults[i];
      await DB.doc('teams/'+t.id).set({
        name:t.name, description:t.description, kind:t.kind, accepting:t.accepting,
        memberIds: [], createdAt: now()
      });
    }
    await DB.doc('meta/bootstrap').set({seededAt: now()});
  }catch(e){ /* seeding is best-effort */ }
}

/* =========================================================
   SIGN-IN SCREEN  (rendered once; not touched by live snapshots)
========================================================= */
async function renderSignIn(){
  var app = document.getElementById('app');
  var teamsForChips = [];
  try{
    var snap = await DB.collection('teams').get();
    teamsForChips = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
  }catch(e){}

  app.innerHTML =
  '<div class="splash safe-top">'+
    '<div class="splash-hero">'+
      logoMarkSVG(52,'light')+
      '<h1 class="splash-title heading">Indianola First<small>Prayer Wall</small></h1>'+
      '<div class="splash-tagline">RESCUE &nbsp;·&nbsp; DEVELOP &nbsp;·&nbsp; DEPLOY</div>'+
    '</div>'+
    '<div class="splash-card">'+
      '<div>'+
        '<div style="font-weight:800; font-size:16px; margin-bottom:2px;">You\'re invited to the wall</div>'+
        '<div class="muted">This space is just for our church family — share what\'s on your heart, and carry each other\'s needs.</div>'+
      '</div>'+
      '<div class="field">'+
        '<label for="si-name">Your name</label>'+
        '<input id="si-name" type="text" placeholder="Jamie Reyes" autocomplete="name" />'+
      '</div>'+
      '<div class="field">'+
        '<label for="si-email">Email</label>'+
        '<input id="si-email" type="email" placeholder="jamie@example.com" autocomplete="email" />'+
      '</div>'+
      '<div class="field">'+
        '<label>Which prayer teams would you like to be part of?</label>'+
        '<div class="chiprow" id="si-teams">'+
          teamsForChips.map(function(t){
            return '<div class="chip" data-team="'+t.id+'">'+escapeHtml(t.name)+'</div>';
          }).join('')+
        '</div>'+
      '</div>'+
      '<div>'+
        '<button type="button" class="link-btn" id="si-admin-link">I\'m staff — I have a passcode</button>'+
        '<div class="field" id="si-passcode-wrap" style="display:none; margin-top:8px;">'+
          '<input id="si-passcode" type="text" placeholder="Staff passcode" />'+
        '</div>'+
      '</div>'+
      '<div class="err" id="si-err"></div>'+
      '<button class="btn btn-primary btn-block" id="si-submit" type="button">Join the wall</button>'+
      (S.usingMock ? '<div class="muted" style="text-align:center;">Solo preview mode — open this as a published artifact for a shared, multi-member wall.</div>' : '')+
    '</div>'+
  '</div>';

  var selected = {};
  qsa('#si-teams .chip').forEach(function(chip){
    chip.addEventListener('click', function(){
      var id = chip.getAttribute('data-team');
      selected[id] = !selected[id];
      chip.classList.toggle('active', !!selected[id]);
    });
  });
  qs('#si-admin-link').addEventListener('click', function(){
    var w = qs('#si-passcode-wrap');
    w.style.display = w.style.display==='none' ? 'block' : 'none';
  });
  qs('#si-submit').addEventListener('click', async function(){
    var name = qs('#si-name').value.trim();
    var email = qs('#si-email').value.trim();
    var err = qs('#si-err');
    err.textContent = '';
    if(!name){ err.textContent = 'Please share your name.'; return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent = 'That email doesn\'t look quite right.'; return; }
    var btn = qs('#si-submit'); btn.textContent = 'Joining…'; btn.disabled = true;

    var id = uid();
    var passcode = (qs('#si-passcode') && qs('#si-passcode').value.trim()) || '';
    var teamIds = Object.keys(selected).filter(function(k){ return selected[k]; });

    var isFirst = false;
    try{
      var pSnap = await DB.collection('profiles').get();
      isFirst = pSnap.docs.length === 0;
    }catch(e){}
    var role = isFirst ? 'admin' : (passcode === ADMIN_PASSCODE ? 'admin' : 'member');

    var profile = {
      name: name, email: email, teams: teamIds, role: role,
      color: colorForName(name), joinedAt: now()
    };
    try{
      await DB.doc('profiles/'+id).set(profile);
      for(var i=0;i<teamIds.length;i++){
        try{
          var tid = teamIds[i];
          var tSnap = await DB.doc('teams/'+tid).get();
          if(tSnap.exists){
            var td = tSnap.data();
            var members = Array.isArray(td.memberIds) ? td.memberIds.slice() : [];
            if(members.indexOf(id)===-1) members.push(id);
            await DB.doc('teams/'+tid).update({memberIds: members});
          }
        }catch(e){}
      }
      localStorage.setItem('if_pw_uid', id);
      S.profile = Object.assign({id:id}, profile);
      startApp();
    }catch(e){
      err.textContent = 'Something interrupted that — please try again.';
      btn.textContent = 'Join the wall'; btn.disabled = false;
    }
  });
}

/* =========================================================
   LOGO MARK
========================================================= */
function logoMarkSVG(size, mode){
  var circleFill = mode==='light' ? '#F0F1F2' : '#022E40';
  var glyphFill = mode==='light' ? '#022E40' : '#F0F1F2';
  return '<svg class="mark" width="'+size+'" height="'+size+'" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="50" cy="50" r="49" fill="'+circleFill+'"/>'+
    '<rect x="46" y="8" width="8" height="84" fill="'+glyphFill+'"/>'+
    '<rect x="8" y="46" width="84" height="8" fill="'+glyphFill+'"/>'+
    '<path d="M62 58 C58 66 58 72 63 78 C68 84 78 84 82 76 C85 70 82 63 76 60 C77 65 75 68 72 68 C74 63 71 58 66 55 C67 59 65 62 62 58 Z" fill="'+circleFill+'" stroke="'+glyphFill+'" stroke-width="0" />'+
    '<path d="M63 60 C60 67 60 72 64 77 C68 82 77 81 80 74 C82 69 80 63 75 61 C76 65 74 67 72 67 C73 63 71 59 67 57 C68 60 66 63 63 60 Z" fill="'+glyphFill+'" />'+
  '</svg>';
}

/* =========================================================
   MAIN APP
========================================================= */
var unsubs = [];
function startApp(){
  unsubs.forEach(function(u){ try{u();}catch(e){} });
  unsubs = [];

  unsubs.push(DB.collection('profiles').onSnapshot(function(snap){
    S.profiles = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    var mine = S.profiles.find(function(p){ return p.id===S.profile.id; });
    if(mine) S.profile = mine;
    render();
  }));
  unsubs.push(DB.collection('teams').onSnapshot(function(snap){
    S.teams = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    render();
  }));
  unsubs.push(DB.collection('prayers').orderBy('createdAt','desc').limit(300).onSnapshot(function(snap){
    S.prayers = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    render();
  }));
  unsubs.push(DB.collection('notes').orderBy('addedAt','desc').limit(200).onSnapshot(function(snap){
    S.notes = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    render();
  }));
  unsubs.push(DB.doc('settings/app').onSnapshot(function(snap){
    if(snap.exists) S.settings = Object.assign({checkinDays:3}, snap.data());
    render();
  }));
}

function setView(v){ S.view = v; render(); }

function render(){
  var app = document.getElementById('app');
  var activeEmergencies = S.prayers.filter(function(p){ return p.urgency==='emergency' && p.status!=='answered'; });

  app.innerHTML =
    '<div class="topbar safe-top">'+
      logoMarkSVG(30,'light')+
      '<div class="title">Indianola First<small>Prayer Wall</small></div>'+
      '<div class="avatar" style="background:'+(S.profile.color||'#346173')+'" data-action="go-me">'+initials(S.profile.name)+'</div>'+
    '</div>'+
    '<div class="stats">'+
      stat(S.profiles.length,'Members')+
      stat(S.prayers.filter(function(p){return p.status!=='answered';}).length,'Active needs')+
      stat(liftedUpCount(),'Praying now')+
      stat(S.prayers.filter(function(p){return p.status==='answered';}).length,'Praise reports')+
    '</div>'+
    (activeEmergencies.length ? emergencyBanner(activeEmergencies) : '')+
    '<div class="main" id="main-scroll">'+
      (S.view==='feed' ? renderFeed(activeEmergencies) :
       S.view==='teams' ? renderTeams() :
       S.view==='notes' ? renderNotes() :
       S.view==='praise' ? renderPraise() :
       renderMe())+
    '</div>'+
    '<div class="navbar safe-bottom">'+
      navItem('feed','🙏','Feed', activeEmergencies.length)+
      navItem('teams','👥','Teams',0)+
      navItem('notes','📝','Notes',0)+
      navItem('praise','🎉','Praise',0)+
      navItem('me','🧑','Me',0)+
    '</div>';

  bindGlobalActions();
}

function stat(n,label){
  return '<div class="stat"><div class="n">'+n+'</div><div class="l">'+label+'</div></div>';
}
function liftedUpCount(){
  var set = {};
  S.prayers.forEach(function(p){
    if(p.status!=='answered' && Array.isArray(p.prayingIds)) p.prayingIds.forEach(function(id){ set[id]=true; });
  });
  return Object.keys(set).length;
}
function navItem(view, icon, label, pip){
  var active = S.view===view;
  return '<button class="navitem '+(active?'active':'')+'" data-action="set-view" data-view="'+view+'">'+
    (pip>0?'<span class="pip"></span>':'')+
    '<span class="ic">'+icon+'</span><span class="lb">'+label+'</span></button>';
}
function emergencyBanner(list){
  return '<div class="emergency-banner" data-action="open-prayer" data-id="'+list[0].id+'">'+
    '<span class="dot"></span>'+
    '<div><div class="t">'+list.length+' urgent need'+(list.length>1?'s':'')+' right now</div>'+
    '<div class="s">Tap to pray with '+escapeHtml(displayName(list[0]))+' right now</div></div>'+
  '</div>';
}
function displayName(p){
  if(p.anonymous) return 'A church member';
  var owner = profileById(p.requesterId);
  return p.requesterName || (owner && owner.name) || 'A church member';
}

/* ---------------- FEED ---------------- */
function checkinThresholdMs(){ return (S.settings.checkinDays||3) * 86400000; }
function isStale(p){
  if(p.status==='answered') return false;
  var last = p.updatedAt || p.createdAt || 0;
  return (now() - last) > checkinThresholdMs();
}
function renderCheckins(){
  var mine = S.prayers.filter(function(p){
    return p.requesterId===S.profile.id && (p.status==='in_process' || p.status==='new') && isStale(p);
  });
  if(!mine.length) return '';
  var html = '<div class="checkin-wrap">';
  mine.forEach(function(p){
    var days = Math.round((now()-(p.updatedAt||p.createdAt))/86400000);
    html += '<div class="checkin-card">'+
      '<div class="k">Checking in with you</div>'+
      '<div class="t">'+escapeHtml(p.title)+'</div>'+
      '<div class="s">It\'s been '+days+' day'+(days===1?'':'s')+' since the last update — how\'s this going?</div>'+
      '<div class="checkin-actions">'+
        '<button data-action="checkin" data-id="'+p.id+'" data-kind="still">Still walking through it</button>'+
        '<button data-action="checkin" data-id="'+p.id+'" data-kind="progress">Seeing progress</button>'+
        '<button class="answer" data-action="open-testimony" data-id="'+p.id+'">It\'s answered 🎉</button>'+
      '</div>'+
    '</div>';
  });
  html += '</div>';
  return html;
}
function renderFeed(activeEmergencies){
  var list = S.prayers.filter(visibleToUser);
  if(S.filter==='new') list = list.filter(function(p){ return p.status==='new'; });
  if(S.filter==='in_process') list = list.filter(function(p){ return p.status==='in_process'; });
  if(S.filter==='emergency') list = list.filter(function(p){ return p.urgency==='emergency'; });
  if(S.filter==='all') list = list.filter(function(p){ return p.status!=='answered'; });

  list.sort(function(a,b){
    var ae = a.urgency==='emergency'&&a.status!=='answered' ? 1:0;
    var be = b.urgency==='emergency'&&b.status!=='answered' ? 1:0;
    if(ae!==be) return be-ae;
    return (b.createdAt||0)-(a.createdAt||0);
  });

  var html = '<div class="section-pad">'+
    '<div class="row-between">'+
      '<div><div class="section-title heading">The wall</div>'+
      '<div class="section-sub" style="margin-bottom:0;">Bring what\'s on your heart. We\'ll carry it with you.</div></div>'+
    '</div>'+
    '<div style="margin-top:14px;"><button class="btn btn-primary btn-block" data-action="open-new-prayer">🙏 Share a need</button></div>'+
    renderCheckins()+
  '</div>'+
  '<div class="filters">'+
    filterChip('all','All active')+
    filterChip('new','Just shared')+
    filterChip('in_process','In process')+
    filterChip('emergency','Urgent')+
  '</div>'+
  '<div class="section-pad" style="padding-top:0;">';

  if(list.length===0){
    html += '<div class="empty"><div class="big">🕊️</div><div style="font-weight:700; font-size:15px;">Nothing here yet</div>'+
      '<p>Be the first to open up — someone on this wall is ready to stand with you.</p></div>';
  } else {
    html += list.map(prayerCard).join('');
  }
  html += '</div>';
  return html;
}
function filterChip(key,label){
  return '<div class="chip '+(S.filter===key?'active':'')+'" data-action="set-filter" data-filter="'+key+'">'+label+'</div>';
}
function prayerCard(p){
  var meta = STATUS_META[p.status] || STATUS_META.new;
  var isEmergency = p.urgency==='emergency' && p.status!=='answered';
  var stripeColor = isEmergency ? 'var(--coral)' : meta.color;
  var team = teamById(p.teamId);
  var praying = Array.isArray(p.prayingIds) ? p.prayingIds : [];
  var isPraying = praying.indexOf(S.profile.id) > -1;
  var updateCount = p.updateCount || 0;

  return '<div class="card" data-action="open-prayer" data-id="'+p.id+'">'+
    '<div class="stripe" style="background:'+stripeColor+(isEmergency?';animation:pulse 1.6s infinite':'')+'"></div>'+
    '<div class="body">'+
      '<div class="card-head">'+
        '<div class="who">'+escapeHtml(displayName(p))+'</div>'+
        '<div class="when">'+fmtTime(p.createdAt)+'</div>'+
      '</div>'+
      '<div class="badges">'+
        (isEmergency ? '<span class="badge" style="background:var(--coral);color:#fff;">urgent</span>' : '')+
        '<span class="badge" style="background:'+meta.color+'22;color:'+meta.color+';border:1px solid '+meta.color+'55;">'+meta.label+'</span>'+
        (team ? '<span class="badge" style="background:var(--surface-2);color:var(--text-muted);">'+escapeHtml(team.name)+'</span>' : '')+
      '</div>'+
      '<div class="card-title">'+escapeHtml(p.title)+'</div>'+
      '<div class="card-excerpt">'+escapeHtml(p.body)+'</div>'+
      '<div class="card-foot">'+
        '<button class="pray-btn '+(isPraying?'active':'')+'" data-action="toggle-pray" data-id="'+p.id+'">'+
          (isPraying?'🙏 Praying':'🙏 Pray')+' · '+praying.length+
        '</button>'+
        '<span class="meta-inline">💬 '+updateCount+'</span>'+
      '</div>'+
      (canManage(p) && isStale(p) ? '<div class="stale-note">No update in '+Math.round((now()-(p.updatedAt||p.createdAt))/86400000)+'+ days — a quick check-in would mean a lot</div>' : '')+
    '</div>'+
  '</div>';
}

/* ---------------- TEAMS ---------------- */
function renderTeams(){
  var html = '<div class="section-pad">'+
    '<div class="section-title heading">Prayer teams</div>'+
    '<div class="section-sub">Choose who carries a need — from the whole church family to a smaller, closer circle.</div>';

  if(S.profile.role==='admin'){
    html += '<div class="admin-box">'+
      '<div class="h">Admin — team routing</div>'+
      '<div class="muted" style="color:#cfe1e8; margin-bottom:10px;">Add teams, and open or close them to new requests.</div>'+
      '<button class="btn btn-sm" data-action="open-new-team">+ New team</button>'+
    '</div>';
  }

  var teams = S.teams.slice().sort(function(a,b){ return (a.createdAt||0)-(b.createdAt||0); });
  teams.forEach(function(t){
    var mine = t.memberIds && t.memberIds.indexOf(S.profile.id)>-1;
    var kindLabel = t.kind==='pastor' ? 'Pastor & staff only' : t.kind==='all' ? 'Open to everyone' : 'Small group';
    html += '<div class="team-card">'+
      '<div class="row-between">'+
        '<div><div class="team-kind">'+kindLabel+'</div><div class="team-name">'+escapeHtml(t.name)+'</div></div>'+
        (S.profile.role==='admin' ? '<button class="link-btn" data-action="toggle-accepting" data-id="'+t.id+'">'+(t.accepting?'Close intake':'Reopen')+'</button>' : '')+
      '</div>'+
      '<div class="team-desc">'+escapeHtml(t.description||'')+'</div>'+
      '<div class="team-foot">'+
        '<span class="meta-inline">'+(t.memberIds?t.memberIds.length:0)+' member'+((t.memberIds&&t.memberIds.length===1)?'':'s')+'</span>'+
        (!t.accepting ? '<span class="closed-pill">Not taking requests</span>' :
          (t.kind==='all' ? '<span class="closed-pill">Everyone\'s in</span>' :
            '<button class="btn btn-sm '+(mine?'btn-ghost':'btn-primary')+'" data-action="toggle-team-membership" data-id="'+t.id+'">'+(mine?'Leave':'Join')+'</button>'))+
      '</div>'+
    '</div>';
  });
  html += '</div>';
  return html;
}

/* ---------------- NOTES (ministry / sermon notes) ---------------- */
function renderNotes(){
  var myTeams = S.teams.filter(function(t){
    return S.profile.role==='admin' || (t.memberIds && t.memberIds.indexOf(S.profile.id)>-1) || t.kind==='all';
  });
  var visible = S.notes.filter(function(n){
    var t = teamById(n.teamId);
    return !t || t.kind==='all' || (t.memberIds && t.memberIds.indexOf(S.profile.id)>-1) || S.profile.role==='admin';
  });

  var html = '<div class="section-pad">'+
    '<div class="section-title heading">Ministry notes</div>'+
    '<div class="section-sub">Sermon takeaways and small-group notes, pulled in from Granola so every ministry can build on them.</div>'+
    '<button class="btn btn-primary btn-block" data-action="open-granola-sync" style="margin-bottom:16px;">📝 Sync notes from Granola</button>';

  if(visible.length===0){
    html += '<div class="empty"><div class="big">📝</div><div style="font-weight:700; font-size:15px;">No notes yet</div>'+
      '<p>Sync a recent sermon or meeting from Granola, or check back after your group leader adds one.</p></div>';
  } else {
    visible.slice().sort(function(a,b){ return (b.addedAt||0)-(a.addedAt||0); }).forEach(function(n){
      var team = teamById(n.teamId);
      html += '<div class="note-card">'+
        '<div class="k">'+(team?escapeHtml(team.name):'Congregation-Wide')+' · '+(n.date||fmtTime(n.addedAt))+'</div>'+
        '<div class="t">'+escapeHtml(n.title)+'</div>'+
        '<div class="d">Added by '+escapeHtml(n.addedByName||'a leader')+'</div>'+
        '<div class="note-body" id="note-body-'+n.id+'">'+escapeHtml(n.body)+'</div>'+
        '<button class="note-expand" data-action="expand-note" data-id="'+n.id+'">Read more</button>'+
      '</div>';
    });
  }
  html += '</div>';
  return html;
}

/* ---------------- PRAISE ---------------- */
function renderPraise(){
  var list = S.prayers.filter(function(p){ return p.status==='answered'; })
    .sort(function(a,b){ return (b.answeredAt||0)-(a.answeredAt||0); });
  var html = '<div class="section-pad">'+
    '<div class="section-title heading">Praise reports</div>'+
    '<div class="section-sub">Every prayer finds a home here eventually. Come celebrate what\'s been answered.</div>';

  if(list.length===0){
    html += '<div class="empty"><div class="big">✨</div><div style="font-weight:700; font-size:15px;">No praise reports yet</div>'+
      '<p>When a need on the wall is answered, its story lands here for everyone to celebrate.</p></div>';
  } else {
    list.forEach(function(p){
      var celebrate = Array.isArray(p.celebrateIds) ? p.celebrateIds : [];
      var did = celebrate.indexOf(S.profile.id) > -1;
      var days = p.answeredAt ? daysBetween(p.createdAt, p.answeredAt) : null;
      html += '<div class="praise-card" data-action="open-prayer" data-id="'+p.id+'">'+
        '<div class="praise-eyebrow">🎉 Answered'+(days?' · carried for '+days+' day'+(days===1?'':'s'):'')+'</div>'+
        '<div style="font-weight:800; font-size:15.5px;">'+escapeHtml(p.title)+'</div>'+
        '<div class="praise-need">'+escapeHtml(p.body)+'</div>'+
        '<div class="praise-testimony">'+escapeHtml(p.testimony||'')+'</div>'+
        '<div class="praise-foot">'+
          '<span class="meta-inline">— '+escapeHtml(displayName(p))+'</span>'+
          '<button class="pray-btn '+(did?'active':'')+'" data-action="toggle-celebrate" data-id="'+p.id+'" style="border-color:var(--green);'+(did?'background:var(--green);color:#fff;':'')+'">🎉 '+celebrate.length+'</button>'+
        '</div>'+
      '</div>';
    });
  }
  html += '</div>';
  return html;
}

/* ---------------- ME / ADMIN ---------------- */
function renderMe(){
  var mine = S.prayers.filter(function(p){ return p.requesterId===S.profile.id; });
  var html = '<div class="section-pad">'+
    '<div class="profile-hero">'+
      '<div class="avatar" style="background:'+(S.profile.color||'#346173')+'">'+initials(S.profile.name)+'</div>'+
      '<div><div class="name">'+escapeHtml(S.profile.name)+'</div><div class="email">'+escapeHtml(S.profile.email)+'</div></div>'+
      '<span class="role-pill '+(S.profile.role==='admin'?'admin':'')+'" style="margin-left:auto;">'+(S.profile.role==='admin'?'Staff / Admin':'Member')+'</span>'+
    '</div>'+
    '<div class="list-item"><div><div class="lt">My teams</div><div class="ld">'+(S.profile.teams&&S.profile.teams.length ? S.profile.teams.map(function(id){var t=teamById(id); return t?t.name:'';}).filter(Boolean).join(', ') : 'None yet — visit Teams to join one')+'</div></div></div>'+
    '<div class="toggle-row"><div><div class="lt" style="font-weight:600; font-size:14px;">Notify me about my needs</div><div class="ld">Prototype only — no push notifications yet</div></div>'+
      '<button class="switch on" disabled></button></div>'+
    '<div class="list-item"><div><div class="lt">My prayer needs shared</div><div class="ld">'+mine.length+' total</div></div></div>'+
    '<div style="margin-top:14px; display:flex; flex-direction:column; gap:8px;">'+
      '<button class="btn btn-primary btn-block" data-action="open-present">📣 Sunday install screen (QR)</button>'+
      '<button class="btn btn-ghost btn-block" data-action="sign-out">Sign out</button>'+
    '</div>';

  if(S.profile.role==='admin'){
    var pendingEmergencies = S.prayers.filter(function(p){ return p.urgency==='emergency'; });
    html += '<div style="margin-top:26px;"><div class="section-title heading" style="font-size:17px;">Admin tools</div></div>'+
      '<div class="admin-box">'+
        '<div class="h">Check-in reminders</div>'+
        '<div class="muted" style="color:#cfe1e8; margin-bottom:8px;">When a need has gone this many days without an update, the requester sees a gentle "how\'s this going?" prompt.</div>'+
        '<div style="display:flex; gap:8px;">'+
          '<input id="admin-checkin-days" type="text" inputmode="numeric" value="'+(S.settings.checkinDays||3)+'" style="width:64px; padding:8px; border-radius:8px; border:none; text-align:center; font-weight:700;" />'+
          '<button class="btn btn-sm" data-action="save-checkin-days">Save</button>'+
        '</div>'+
      '</div>'+
      '<div class="admin-box">'+
        '<div class="h">Urgent-need review</div>'+
        (pendingEmergencies.length===0 ? '<div class="muted" style="color:#cfe1e8;">No urgent needs to review — they broadcast instantly and land here for a follow-up look.</div>' :
          pendingEmergencies.map(function(p){
            return '<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-top:1px solid rgba(255,255,255,.15);">'+
              '<div style="font-size:13px;">'+escapeHtml(p.title)+'</div>'+
              '<button class="btn btn-sm" data-action="downgrade-emergency" data-id="'+p.id+'">Resolve flag</button>'+
            '</div>';
          }).join(''))+
      '</div>'+
      '<div class="section-title heading" style="font-size:16px;">Member directory ('+S.profiles.length+')</div>';
    S.profiles.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');}).forEach(function(pr){
      html += '<div class="list-item"><div><div class="lt">'+escapeHtml(pr.name)+'</div><div class="ld">'+escapeHtml(pr.email)+'</div></div>'+
        (pr.id!==S.profile.id ? '<button class="link-btn" data-action="toggle-role" data-id="'+pr.id+'">'+(pr.role==='admin'?'Remove admin':'Make admin')+'</button>' : '<span class="role-pill admin">You</span>')+
      '</div>';
    });
  }
  html += '</div>';
  return html;
}

/* =========================================================
   OVERLAYS / SHEETS
========================================================= */
function openSheet(id, title, bodyHtml){
  var root = document.getElementById('overlay-root');
  root.innerHTML =
    '<div class="sheet-backdrop" id="sheet-backdrop"></div>'+
    '<div class="sheet" id="sheet-'+id+'">'+
      '<div class="sheet-handle"></div>'+
      '<div class="sheet-head"><h3>'+title+'</h3><button class="sheet-close" data-action="close-sheet">✕</button></div>'+
      '<div class="sheet-body" id="sheet-body">'+bodyHtml+'</div>'+
    '</div>';
  requestAnimationFrame(function(){
    qs('#sheet-backdrop').classList.add('show');
    qs('#sheet-'+id).classList.add('show');
  });
  qs('#sheet-backdrop').addEventListener('click', closeSheet);
  qsa('[data-action="close-sheet"]').forEach(function(b){ b.addEventListener('click', closeSheet); });
}
function closeSheet(){
  var backdrop = qs('#sheet-backdrop');
  var sheet = qs('.sheet');
  if(backdrop) backdrop.classList.remove('show');
  if(sheet) sheet.classList.remove('show');
  setTimeout(function(){ document.getElementById('overlay-root').innerHTML=''; }, 220);
}

/* ---- New prayer sheet ---- */
function openNewPrayerSheet(){
  var acceptingTeams = S.teams.filter(function(t){ return t.accepting; });
  var body =
    '<div class="field"><label for="np-title">What\'s it about? (a short title)</label>'+
      '<input id="np-title" type="text" maxlength="70" placeholder="My mom\'s upcoming surgery" /></div>'+
    '<div class="field"><label for="np-body">Tell us more</label>'+
      '<textarea id="np-body" maxlength="800" placeholder="Share as much or as little as you\'d like…"></textarea></div>'+
    '<div class="field"><label for="np-team">Send this to</label>'+
      '<select id="np-team">'+ acceptingTeams.map(function(t){ return '<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>'; }).join('') +'</select></div>'+
    '<div class="toggle-row"><div><div class="lt" style="font-weight:600; font-size:14px;">Share anonymously</div><div class="ld">Others will see "A church member"</div></div>'+
      '<button class="switch" id="np-anon" data-action="toggle-switch"></button></div>'+
    '<div class="toggle-row"><div><div class="lt" style="font-weight:600; font-size:14px;" class="req-flag">This needs prayer right now</div><div class="ld">Broadcasts instantly to the whole church, flagged urgent</div></div>'+
      '<button class="switch" id="np-urgent" data-action="toggle-switch"></button></div>'+
    '<div class="err" id="np-err"></div>'+
    '<button class="btn btn-primary btn-block" id="np-submit" type="button" style="margin-top:6px;">Share this need</button>';
  openSheet('new-prayer','Share a need', body);

  qsa('#sheet-body .switch').forEach(function(sw){
    sw.addEventListener('click', function(){ sw.classList.toggle('on'); });
  });
  qs('#np-submit').addEventListener('click', async function(){
    var title = qs('#np-title').value.trim();
    var bodyTxt = qs('#np-body').value.trim();
    var err = qs('#np-err'); err.textContent='';
    if(!title){ err.textContent='Give it a short title.'; return; }
    if(!bodyTxt){ err.textContent='Share a little about the need.'; return; }
    var teamSel = qs('#np-team');
    var teamId = teamSel ? teamSel.value : 'congregation';
    var anon = qs('#np-anon').classList.contains('on');
    var urgent = qs('#np-urgent').classList.contains('on');
    var btn = qs('#np-submit'); btn.textContent='Sharing…'; btn.disabled=true;
    try{
      await DB.collection('prayers').add({
        title: title, body: bodyTxt, teamId: teamId,
        requesterId: S.profile.id, requesterName: S.profile.name, anonymous: anon,
        status: 'new', urgency: urgent ? 'emergency' : 'normal', emergencyApproved: urgent,
        prayingIds: [], celebrateIds: [], updateCount: 0,
        createdAt: now(), updatedAt: now(), testimony: null, answeredAt: null
      });
      closeSheet();
      toast(urgent ? 'Shared — everyone\'s been notified. We\'re praying with you.' : 'Shared with '+ (teamById(teamId)?teamById(teamId).name:'the team') +'.');
    }catch(e){
      err.textContent = 'That didn\'t go through — please try again.';
      btn.textContent='Share this need'; btn.disabled=false;
    }
  });
}

/* ---- New team sheet (admin) ---- */
function openNewTeamSheet(){
  var body =
    '<div class="field"><label for="nt-name">Team name</label><input id="nt-name" type="text" placeholder="Sisterhood Prayer Circle" /></div>'+
    '<div class="field"><label for="nt-desc">Description</label><textarea id="nt-desc" placeholder="Who is this for, and how will these needs be carried?"></textarea></div>'+
    '<div class="field"><label for="nt-kind">Visibility</label>'+
      '<select id="nt-kind"><option value="group">Small group — members only</option><option value="pastor">Pastor / staff only</option><option value="all">Open to the whole church</option></select></div>'+
    '<div class="err" id="nt-err"></div>'+
    '<button class="btn btn-primary btn-block" id="nt-submit" type="button">Create team</button>';
  openSheet('new-team','New prayer team', body);
  qs('#nt-submit').addEventListener('click', async function(){
    var name = qs('#nt-name').value.trim();
    var desc = qs('#nt-desc').value.trim();
    var kind = qs('#nt-kind').value;
    var err = qs('#nt-err'); err.textContent='';
    if(!name){ err.textContent='Give the team a name.'; return; }
    try{
      var id = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || uid();
      await DB.doc('teams/'+id).set({ name:name, description:desc, kind:kind, accepting:true, memberIds:[S.profile.id], createdAt: now() });
      closeSheet(); toast('Team created.');
    }catch(e){ err.textContent='Couldn\'t create that team — try again.'; }
  });
}

/* ---- Prayer detail sheet ---- */
async function openPrayerDetail(id){
  var p = S.prayers.find(function(x){ return x.id===id; });
  if(!p) return;
  var meta = STATUS_META[p.status] || STATUS_META.new;
  var team = teamById(p.teamId);
  var praying = Array.isArray(p.prayingIds) ? p.prayingIds : [];
  var isPraying = praying.indexOf(S.profile.id)>-1;
  var manage = canManage(p);

  var body =
    '<div class="badges">'+
      (p.urgency==='emergency' ? '<span class="badge" style="background:var(--coral);color:#fff;">urgent</span>' : '')+
      '<span class="badge" style="background:'+meta.color+'22;color:'+meta.color+';border:1px solid '+meta.color+'55;">'+meta.label+'</span>'+
      (team ? '<span class="badge" style="background:var(--surface-2);color:var(--text-muted);">'+escapeHtml(team.name)+'</span>' : '')+
    '</div>'+
    '<div class="card-head" style="margin-top:8px;"><div class="who">'+escapeHtml(displayName(p))+'</div><div class="when">'+fmtTime(p.createdAt)+'</div></div>'+
    '<div class="detail-body">'+escapeHtml(p.body)+'</div>'+
    (p.status==='answered' ? '<div class="praise-card" style="padding:12px; margin-bottom:14px;"><div class="praise-eyebrow">🎉 Testimony</div><div class="praise-testimony">'+escapeHtml(p.testimony||'')+'</div></div>' : '')+
    '<div class="action-grid">'+
      '<button class="pray-btn '+(isPraying?'active':'')+'" data-action="toggle-pray" data-id="'+p.id+'">'+(isPraying?'🙏 Praying · ':'🙏 Pray · ')+praying.length+'</button>'+
      (manage && p.status==='new' ? '<button class="btn btn-sm btn-ghost" data-action="mark-in-process" data-id="'+p.id+'">Mark in process</button>' : '')+
      (manage && p.status!=='answered' ? '<button class="btn btn-sm btn-ghost" data-action="open-testimony" data-id="'+p.id+'">🎉 We saw an answer</button>' : '')+
    '</div>'+
    '<div style="font-weight:700; font-size:13.5px; margin-bottom:8px;">Journey updates</div>'+
    '<div id="update-list">Loading…</div>'+
    (manage ? '<div class="field" style="margin-top:12px;"><label for="upd-note">Add an update</label>'+
      '<textarea id="upd-note" placeholder="Still praying, saw some movement today…" style="min-height:64px;"></textarea>'+
      '<button class="btn btn-sm btn-primary" id="upd-submit" type="button" style="margin-top:8px;">Post update</button></div>' : '');

  openSheet('detail', 'Prayer need', body);
  loadUpdates(id);

  if(manage){
    var us = qs('#upd-submit');
    if(us) us.addEventListener('click', async function(){
      var txt = qs('#upd-note').value.trim();
      if(!txt) return;
      us.disabled = true;
      try{
        await DB.collection('prayers/'+id+'/updates').add({ type:'note', body:txt, authorId:S.profile.id, authorName:S.profile.name, createdAt: now() });
        await DB.doc('prayers/'+id).update({ updateCount: (p.updateCount||0)+1, updatedAt: now() });
        qs('#upd-note').value=''; loadUpdates(id); toast('Update posted.');
      }catch(e){ toast('Couldn\'t post that — try again.'); }
      us.disabled = false;
    });
  }
}
async function loadUpdates(id){
  var host = qs('#update-list');
  if(!host) return;
  try{
    var snap = await DB.collection('prayers/'+id+'/updates').orderBy('createdAt','asc').limit(100).get();
    var docs = snap.docs.map(function(d){ return d.data(); });
    if(!docs.length){ host.innerHTML = '<div class="muted">No updates yet — the first one often means someone showed up.</div>'; return; }
    host.innerHTML = docs.map(function(u){
      var tagColor = u.type==='testimony' ? 'var(--green)' : 'var(--if-blue-pale)';
      var tagText = u.type==='testimony' ? 'testimony' : 'update';
      return '<div class="update-item"><div class="who">'+escapeHtml(u.authorName||'Someone')+
        '<span class="update-tag" style="background:'+tagColor+'33; color:'+tagColor+';">'+tagText+'</span></div>'+
        '<div class="txt">'+escapeHtml(u.body)+'</div><div class="when">'+fmtTime(u.createdAt)+'</div></div>';
    }).join('');
  }catch(e){ host.innerHTML = '<div class="muted">Updates aren\'t available right now.</div>'; }
}

/* ---- Testimony sheet ---- */
function openTestimonySheet(id){
  var body =
    '<div class="muted" style="margin-bottom:12px;">This moves the need to Praise Reports for the whole wall to celebrate.</div>'+
    '<div class="field"><label for="ts-body">What happened?</label><textarea id="ts-body" placeholder="Share the story of how this was answered…"></textarea></div>'+
    '<div class="err" id="ts-err"></div>'+
    '<button class="btn btn-primary btn-block" id="ts-submit" type="button">Post praise report</button>';
  openSheet('testimony','We saw an answer 🎉', body);
  qs('#ts-submit').addEventListener('click', async function(){
    var txt = qs('#ts-body').value.trim();
    var err = qs('#ts-err'); err.textContent='';
    if(!txt){ err.textContent='Share a little about what happened.'; return; }
    try{
      await DB.doc('prayers/'+id).update({ status:'answered', testimony:txt, answeredAt: now(), updatedAt: now() });
      await DB.collection('prayers/'+id+'/updates').add({ type:'testimony', body:txt, authorId:S.profile.id, authorName:S.profile.name, createdAt: now() });
      closeSheet(); setView('praise'); toast('What a testimony — thank you for sharing it.');
    }catch(e){ err.textContent='Couldn\'t post that — try again.'; }
  });
}

/* ---- Granola sync sheet ---- */
function extractMeetingList(text){
  var out = [];
  var re = /<meeting id="([^"]+)" title="([^"]+)" date="([^"]+)"/g;
  var m;
  while((m = re.exec(text))){
    out.push({ id:m[1], title:decodeXml(m[2]), date:decodeXml(m[3]) });
  }
  return out;
}
function extractMeetingSummaries(text){
  var out = [];
  var re = /<meeting id="([^"]+)" title="([^"]+)" date="([^"]+)"[^>]*>([\s\S]*?)<\/meeting>/g;
  var m;
  while((m = re.exec(text))){
    var block = m[4];
    var sm = /<summary>([\s\S]*?)<\/summary>/.exec(block);
    out.push({ id:m[1], title:decodeXml(m[2]), date:decodeXml(m[3]), summary: sm ? sm[1].trim() : '' });
  }
  return out;
}
function decodeXml(s){
  return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function payloadToText(payload){
  try{
    if(typeof payload==='string') return payload;
    if(payload && Array.isArray(payload.content)){
      return payload.content.map(function(c){ return c.text || ''; }).join('\n');
    }
    if(payload && typeof payload.text==='string') return payload.text;
    return JSON.stringify(payload);
  }catch(e){ return ''; }
}

async function openGranolaSyncSheet(){
  var body = '<div class="muted" style="margin-bottom:12px;">This uses your own Granola account — each leader syncs their own notes.</div>'+
    '<div id="granola-status" style="padding:20px 0; text-align:center;" class="muted">Connecting to Granola…</div>';
  openSheet('granola','Sync from Granola', body);

  var mcp = await getMcp();
  var statusEl = qs('#granola-status');
  if(!mcp){
    if(statusEl) statusEl.innerHTML = 'Granola isn\'t connected for this view. Connect it in your claude.ai connector settings, then try again.<br><br><button class="btn btn-ghost" data-action="close-sheet">Close</button>';
    return;
  }
  try{
    var res = await mcp.callTool('Granola', 'list_meetings', { time_range: 'last_30_days' });
    var text = payloadToText(res && res.payload !== undefined ? res.payload : res);
    var meetings = extractMeetingList(text);
    if(!meetings.length){
      if(statusEl) statusEl.innerHTML = 'No recent Granola meetings found in the last 30 days.<br><br><button class="btn btn-ghost" data-action="close-sheet">Close</button>';
      return;
    }
    var teamOptions = S.teams.map(function(t){ return '<option value="'+t.id+'">'+escapeHtml(t.name)+'</option>'; }).join('');
    var host = qs('#sheet-body');
    host.innerHTML =
      '<div class="muted" style="margin-bottom:10px;">Pick the notes to bring into the app.</div>'+
      '<div id="meeting-picker">'+ meetings.map(function(m){
        return '<label class="meeting-pick"><input type="checkbox" class="mp-check" value="'+m.id+'"/>'+
          '<div><div class="mt">'+escapeHtml(m.title)+'</div><div class="md">'+escapeHtml(m.date)+'</div></div></label>';
      }).join('') +'</div>'+
      '<div class="field" style="margin-top:12px;"><label for="gs-team">Post to</label><select id="gs-team">'+teamOptions+'</select></div>'+
      '<div class="err" id="gs-err"></div>'+
      '<button class="btn btn-primary btn-block" id="gs-import" type="button" style="margin-top:6px;">Import selected notes</button>';

    qs('#gs-import').addEventListener('click', async function(){
      var ids = qsa('.mp-check:checked').map(function(c){ return c.value; });
      var err = qs('#gs-err'); err.textContent='';
      if(!ids.length){ err.textContent='Choose at least one meeting.'; return; }
      var teamId = qs('#gs-team').value;
      var btn = qs('#gs-import'); btn.textContent='Importing…'; btn.disabled=true;
      try{
        var res2 = await mcp.callTool('Granola', 'get_meetings', { meeting_ids: ids.slice(0,10) });
        var text2 = payloadToText(res2 && res2.payload !== undefined ? res2.payload : res2);
        var full = extractMeetingSummaries(text2);
        for(var i=0;i<full.length;i++){
          var f = full[i];
          await DB.collection('notes').add({
            title: f.title, date: f.date, body: f.summary || '(No summary available for this note.)',
            teamId: teamId, sourceMeetingId: f.id, addedBy: S.profile.id, addedByName: S.profile.name, addedAt: now()
          });
        }
        closeSheet(); setView('notes'); toast(full.length+' note'+(full.length===1?'':'s')+' imported.');
      }catch(e){
        err.textContent = 'Couldn\'t import right now — try again in a bit.';
        btn.textContent='Import selected notes'; btn.disabled=false;
      }
    });
  }catch(e){
    if(statusEl) statusEl.innerHTML = 'Couldn\'t reach Granola right now.<br><br><button class="btn btn-ghost" data-action="close-sheet">Close</button>';
  }
}

/* ---- Present for Sunday (QR + install) ---- */
function openPresentScreen(){
  var root = document.getElementById('overlay-root');
  var div = document.createElement('div');
  div.className = 'present-screen';
  div.id = 'present-screen';
  div.innerHTML =
    '<button class="present-close" data-action="close-present">✕</button>'+
    logoMarkSVG(46,'light')+
    '<div class="present-qr" id="present-qr"></div>'+
    '<div class="present-title heading">Scan to join the wall</div>'+
    '<div class="present-sub">Point your phone\'s camera at this code, then add it to your home screen.</div>'+
    '<button class="btn btn-primary" id="install-now-btn" data-action="trigger-install" style="margin-top:4px;">⬇️ Install now</button>'+
    '<div class="present-steps">'+
      '<div><b>📱 iPhone</b>Tap the Share icon, then "Add to Home Screen."</div>'+
      '<div><b>🤖 Android</b>Tap "Install now" above, or the ⋮ menu → "Add to Home screen."</div>'+
    '</div>'+
    '<div class="muted" style="color:#A9CBD9; word-break:break-all; max-width:320px;">'+escapeHtml(location.href)+'</div>';
  root.appendChild(div);
  try{
    if(typeof QRCode !== 'undefined'){
      new QRCode(document.getElementById('present-qr'), {
        text: location.href, width:220, height:220, colorDark:"#022E40", colorLight:"#F0F1F2"
      });
    } else {
      document.getElementById('present-qr').innerHTML = '<div style="padding:60px 20px; color:#022E40; font-weight:700; font-size:13px;">QR generator didn\'t load — share the link below instead.</div>';
    }
  }catch(e){
    document.getElementById('present-qr').innerHTML = '<div style="padding:60px 20px; color:#022E40; font-weight:700; font-size:13px;">QR generator didn\'t load — share the link below instead.</div>';
  }
}
function closePresentScreen(){
  var el = document.getElementById('present-screen');
  if(el) el.remove();
}

/* =========================================================
   EVENT DELEGATION
========================================================= */
function bindGlobalActions(){
  /* Bound on body (once — identical listeners are deduped by the browser)
     rather than on #app, because sheets and the full-screen present
     overlay render into #overlay-root, a sibling of #app, not a child
     of it — a listener scoped to #app would never see clicks there. */
  document.body.addEventListener('click', handleAppClick);
}
async function handleAppClick(e){
  var el = e.target.closest('[data-action]');
  if(!el) return;
  var action = el.getAttribute('data-action');
  var id = el.getAttribute('data-id');

  if(action==='set-view'){ setView(el.getAttribute('data-view')); return; }
  if(action==='go-me'){ setView('me'); return; }
  if(action==='set-filter'){ S.filter = el.getAttribute('data-filter'); render(); return; }
  if(action==='open-new-prayer'){ openNewPrayerSheet(); return; }
  if(action==='open-new-team'){ openNewTeamSheet(); return; }
  if(action==='open-prayer'){ openPrayerDetail(id); return; }
  if(action==='open-testimony'){ closeSheet(); setTimeout(function(){ openTestimonySheet(id); }, 230); return; }
  if(action==='sign-out'){ localStorage.removeItem('if_pw_uid'); location.reload(); return; }
  if(action==='open-granola-sync'){ openGranolaSyncSheet(); return; }
  if(action==='expand-note'){
    var nb = document.getElementById('note-body-'+id);
    if(nb){ nb.classList.toggle('expanded'); el.textContent = nb.classList.contains('expanded') ? 'Show less' : 'Read more'; }
    return;
  }
  if(action==='open-present'){ openPresentScreen(); return; }
  if(action==='close-present'){ closePresentScreen(); return; }
  if(action==='trigger-install'){ triggerInstall(); return; }
  if(action==='checkin'){
    var kind = el.getAttribute('data-kind');
    var noteTxt = kind==='progress' ? 'Checked in — seeing progress! 🙂' : 'Checked in — still walking through it, please keep praying.';
    try{
      await DB.collection('prayers/'+id+'/updates').add({ type:'note', body: noteTxt, authorId:S.profile.id, authorName:S.profile.name, createdAt: now() });
      var pr = S.prayers.find(function(x){return x.id===id;});
      await DB.doc('prayers/'+id).update({ updatedAt: now(), updateCount: ((pr&&pr.updateCount)||0)+1, status: pr&&pr.status==='new'?'in_process':(pr?pr.status:'in_process') });
      toast('Thanks for checking in.');
    }catch(err){}
    return;
  }
  if(action==='save-checkin-days'){
    var val = parseInt(qs('#admin-checkin-days').value, 10);
    if(!val || val<1) val = 3;
    try{ await DB.doc('settings/app').set(Object.assign({}, S.settings, {checkinDays: val})); toast('Check-in reminder updated.'); }catch(err){}
    return;
  }

  if(action==='toggle-pray'){
    var p = S.prayers.find(function(x){return x.id===id;});
    if(!p) return;
    var arr = Array.isArray(p.prayingIds) ? p.prayingIds.slice() : [];
    var i = arr.indexOf(S.profile.id);
    if(i>-1) arr.splice(i,1); else arr.push(S.profile.id);
    try{ await DB.doc('prayers/'+id).update({ prayingIds: arr }); }catch(err){}
    return;
  }
  if(action==='toggle-celebrate'){
    var p2 = S.prayers.find(function(x){return x.id===id;});
    if(!p2) return;
    var arr2 = Array.isArray(p2.celebrateIds) ? p2.celebrateIds.slice() : [];
    var j = arr2.indexOf(S.profile.id);
    if(j>-1) arr2.splice(j,1); else arr2.push(S.profile.id);
    try{ await DB.doc('prayers/'+id).update({ celebrateIds: arr2 }); }catch(err){}
    return;
  }
  if(action==='mark-in-process'){
    try{ await DB.doc('prayers/'+id).update({ status:'in_process', updatedAt: now() }); toast('Marked in process.'); closeSheet(); }catch(err){}
    return;
  }
  if(action==='toggle-team-membership'){
    var t = teamById(id); if(!t) return;
    var members = Array.isArray(t.memberIds) ? t.memberIds.slice() : [];
    var k = members.indexOf(S.profile.id);
    if(k>-1) members.splice(k,1); else members.push(S.profile.id);
    try{
      await DB.doc('teams/'+id).update({ memberIds: members });
      var myTeams = Array.isArray(S.profile.teams) ? S.profile.teams.slice() : [];
      var mi = myTeams.indexOf(id);
      if(k>-1){ if(mi>-1) myTeams.splice(mi,1); } else { if(mi===-1) myTeams.push(id); }
      await DB.doc('profiles/'+S.profile.id).update({ teams: myTeams });
    }catch(err){}
    return;
  }
  if(action==='toggle-accepting'){
    var t2 = teamById(id); if(!t2) return;
    try{ await DB.doc('teams/'+id).update({ accepting: !t2.accepting }); }catch(err){}
    return;
  }
  if(action==='downgrade-emergency'){
    try{ await DB.doc('prayers/'+id).update({ urgency:'normal', emergencyApproved:false }); toast('Urgent flag cleared.'); }catch(err){}
    return;
  }
  if(action==='toggle-role'){
    var pr = profileById(id); if(!pr) return;
    var newRole = pr.role==='admin' ? 'member' : 'admin';
    try{ await DB.doc('profiles/'+id).update({ role:newRole }); }catch(err){}
    return;
  }
}

/* =========================================================
   PWA: service worker registration + install prompt capture
   (No-ops harmlessly if unsupported, e.g. older browsers.)
========================================================= */
var deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  deferredInstallPrompt = e;
});
async function triggerInstall(){
  if(!deferredInstallPrompt){
    toast('Use your browser\'s "Add to Home Screen" / "Install app" option.');
    return;
  }
  deferredInstallPrompt.prompt();
  try{ await deferredInstallPrompt.userChoice; }catch(e){}
  deferredInstallPrompt = null;
}
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(err){
      console.warn('Service worker registration failed:', err);
    });
  });
}

/* boot */
boot();
})();
