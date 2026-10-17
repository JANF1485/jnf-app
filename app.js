// Motocaimán — © 2026 Asesorías y Consultorías JNF S.A.S. (NIT 901.904.435-9). Todos los derechos reservados.
// Prohibida su reproducción, copia, modificación o distribución, total o parcial, sin autorización escrita del titular.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, runTransaction, writeBatch, serverTimestamp, getCountFromServer, getAggregateFromServer, count, average } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getDatabase, ref, set, remove, onValue, onDisconnect, serverTimestamp as rtdbTime } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyDCE4TNP_einciB5isvoB_4BwVZjjrJ4nE",
  authDomain: "jnf-moto.firebaseapp.com",
  databaseURL: "https://jnf-moto-default-rtdb.firebaseio.com",
  projectId: "jnf-moto",
  storageBucket: "jnf-moto.firebasestorage.app",
  messagingSenderId: "881645737213",
  appId: "1:881645737213:web:26bf401db841abebe35a94"
};
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const rtdb = getDatabase(fb);

const MIN = 2000;
const APP_VERSION = '26'; // número interno (actualiza la caché)
const APP_LABEL = '1.0'; // versión oficial que ve el usuario
const LOGO = 'icon-192.png';
const appEl = document.getElementById('app');

/* ---------- utilidades ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const parseMoney = v => { const d = String(v).replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : NaN; };
const validAmount = n => isNaN(n) ? 'Escribe un valor en pesos.' : n < MIN ? 'El mínimo es ' + money(MIN) + '.' : n % 100 !== 0 ? 'Usa múltiplos de $100 (por ejemplo $2.300).' : '';
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
const tsMs = t => t && typeof t.toMillis === 'function' ? t.toMillis() : Date.now();
const fmtRating = v => v.toFixed(1).replace('.', ',');
const pagoTxt = v => (v && v.pago === 'transferencia') ? 'Transferencia' : 'Efectivo';
const cobroTxt = v => (v && v.pago === 'transferencia') ? 'Cobrar por transferencia' : 'Cobrar en efectivo';
// Envíos (mensajería): viajes/{id}.tipo = 'envio' y .envio = { contenido, desc, pagaRecibe }.
// Quien recibe va en viajes/{id}/entrega/recibe (lo ve el conductor asignado); el código en entrega/codigo (solo quien envía).
const esEnvio = v => !!(v && v.tipo === 'envio');
const ENV_CONT = [['documentos', 'Documentos'], ['pequeno', 'Paquete pequeño'], ['mediano', 'Paquete mediano'], ['compra', 'Compra / domicilio']];
const contTxt = k => (ENV_CONT.find(x => x[0] === k) || [0, 'Paquete'])[1];
const pagaRec = v => !!(v && v.envio && v.envio.pagaRecibe);
const quienPaga = v => pagaRec(v) ? 'paga quien recibe' : 'paga quien envía';
const TAG_ENV = '<span class="tag">📦 ENVÍO</span>';
function distKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const etaMin = km => Math.max(1, Math.round(km * 3)); // estimado urbano (~20 km/h)
const fmtDist = km => km == null ? '' : km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km';
function errMsg(e) {
  const c = (e && e.code) || '';
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Usa "Ingresar".',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Usa correo y contraseña.',
    'auth/network-request-failed': 'Sin conexión a internet. Revisa tu señal e intenta de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'permission-denied': 'La operación no está permitida.',
    'unavailable': 'Sin conexión con el servidor. Revisa tu señal.'
  };
  return map[c] || (e && e.message && !c ? e.message : 'Ocurrió un error (' + (c || 'desconocido') + '). Intenta de nuevo.');
}
/* ---------- estado ---------- */
const S = {
  screen: 'cargando', user: null, perfil: null, conductor: null, admin: false, mode: 'pasajero',
  f: {}, err: null, banner: null, busy: false,
  pos: null, gps: 'pendiente',
  offer: MIN, otroOpen: false, notaOpen: false, pago: 'efectivo', cTransfer: null,
  viajeId: null, viaje: null, ofertas: [], ratings: {}, cPhone: null, pPhone: null, sos: null, drvPos: null, paxPos: null, route: null, sharing: false, reqMap: null, others: {}, destPin: null, pickDest: false, docs: {}, docsFor: null, rates: {}, cancel: { motivo: null, texto: '' }, admUsers: null, admQ: {}, admLimit: 30, admDocCount: {}, admDriver: null, admTrips: {}, admBack: 'conductores', admMake: null, admKpi: null, hideInstall: false, showPass: false, docMsg: '', admOpen: null, admDocs: {}, admBig: null, admPriv: {}, admEdit: null, admDocMsg: '', cpriv: null, pushUrl: '', pushOk: false, admV: null, admVPage: 20, admCal: {}, admRate: {}, admRateList: {}, admRateOpen: null, admPush: null, admPushRes: '', admAllUsers: null, sus: null, tarifas: null, susMap: null, susId: null, susPagos: null, pagosMes: null, ingresos: null, ingOtro: false, misPagos: null, misRef: null, anularId: null, idFalta: null, tipo: 'viaje', pagaRecibe: false, envCod: null, recibe: null, devAsk: false,
  rating: 5, chips: {}, reportOpen: false,
  online: false, requests: [], ignored: {}, cOtro: {}, stats: null, espera: null,
  cal: null, hist: null, admTab: 'resumen', adm: {},
  masc: null, mascSrc: null, mascClosed: {}, mascList: null, mascThumbs: {}, mascImgData: {}, me: null, mascMsg: '', mascDel: null
};
let subs = [], gsubs = [], map = null, mk = {}, watchId = null, lastPush = 0, audioCtx = null;
const addSub = u => subs.push(u);
function clearSubs() { subs.forEach(u => { try { u(); } catch (e) { } }); subs = []; }
function clearGSubs() { gsubs.forEach(u => { try { u(); } catch (e) { } }); gsubs = []; }

/* ---------- íconos ---------- */
const I = {
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;opacity:.6"><path d="M9 18l6-6-6-6"/></svg>',
  lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  doc: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  eye: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  starOn: '<svg width="40" height="40" viewBox="0 0 24 24" fill="#C9A227" stroke="#A8841A" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>',
  starOff: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--star-off)" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>'
};
const COPY = () => '© ' + new Date().getFullYear() + ' Asesorías y Consultorías JNF S.A.S. · NIT 901.904.435-9 · Todos los derechos reservados.';
const LABELS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];
const RADIO_KM = 2; // zona en la que se cuentan y muestran los conductores cercanos
// Cancelaciones. Las reglas de Firestore usan 2 min, 5 min y ETA+10 min; la app usa márgenes para no contradecirlas.
const GRACIA_S = 105, ESPERA_S = 310, TARDE_EXTRA_MIN = 10.25;
const REC = st => st === 'asignado' || st === 'en_punto'; // fase de recogida
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fromYmd = (s, end) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; return new Date(+m[1], +m[2] - 1, +m[3], end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0); };
const fmtFecha = ms => { const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const fmtClock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const MOTIVOS = {
  pasajero: [['ya_no', 'Ya no lo necesito'], ['no_llega', 'El conductor no llega'], ['inseguro', 'Me siento inseguro'], ['otro', 'Otro motivo']],
  conductor: [['inconveniente', 'Tuve un inconveniente'], ['inseguro', 'Me siento inseguro'], ['otro', 'Otro motivo']]
};
const ASP_C = ['Conducción segura', 'Puntualidad', 'Amabilidad', 'Vehículo limpio', 'Mototour en buen estado'];
const ASP_P = ['Pagó completo', 'Puntual en el punto', 'Respetuoso', 'Cuidó el vehículo'];

/* ---------- piezas de interfaz ---------- */
const brandRow = right => '<div class="row between"><div class="row"><img class="logo" src="' + LOGO + '" alt="Logo JNF S.A.S."><span class="brandname">Motocaimán</span></div>' + (right || '') + '</div>';
const subTop = (title, back) => '<div class="top"><div class="row"><button class="iconbtn" data-act="go" data-v="' + (back || 'menu') + '" aria-label="Volver">' + I.back + '</button><h1 class="h1">' + title + '</h1></div></div>';
function bannerHTML(b) { if (!b) return ''; return '<div class="banner ' + b.kind + '" role="status">' + (b.kind === 'danger' ? I.shield : I.info) + '<div class="grow">' + esc(b.text) + '</div><button data-act="closeBanner" aria-label="Cerrar aviso">Cerrar</button></div>'; }
const errHTML = () => S.err ? '<div class="banner danger" role="alert">' + I.info + '<div class="grow">' + esc(S.err) + '</div><button data-act="closeErr" aria-label="Cerrar error">Cerrar</button></div>' : '';
function starsHTML(val, act) { let h = '<div class="stars" role="group" aria-label="Calificación">'; for (let n = 1; n <= 5; n++) h += '<button class="star" data-act="' + act + '" data-v="' + n + '" aria-label="' + n + (n === 1 ? ' estrella' : ' estrellas') + '" aria-pressed="' + (n <= val) + '">' + (n <= val ? I.starOn : I.starOff) + '</button>'; return h + '</div>'; }
const chipsHTML = (names, sel, act) => '<div class="chips">' + names.map(n => '<button class="chip" data-act="' + act + '" data-v="' + esc(n) + '" aria-pressed="' + (!!sel[n]) + '">' + esc(n) + '</button>').join('') + '</div>';
const fv = k => esc(S.f[k] || '');
function ratingLine(r) { if (!r) return '★ …'; return '★ ' + fmtRating(r.avg) + (r.n < 5 ? ' <span class="pill p-info">Nuevo</span>' : ' · ' + r.n + ' calificaciones'); }
const busyAttr = () => S.busy ? ' disabled' : '';

/* ---------- instalación en el celular ---------- */
let installEvt = null;
const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (['login', 'home', 'menu'].includes(S.screen)) render(); });
window.addEventListener('appinstalled', () => { installEvt = null; S.banner = { kind: 'ok', text: 'Motocaimán quedó instalada. Ábrela desde el ícono en tu celular.' }; render(); });
function homeInstallCard() {
  if (isStandalone() || S.hideInstall) return '';
  const body = installEvt ? '<div class="muted small">Así se abre a pantalla completa, sin la barra del navegador.</div><div class="row"><button class="btn btn-gold btn-sm" style="flex:1" data-act="install">Instalar</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="hideInstall">Ahora no</button></div>'
    : isIOS() ? '<div class="muted small">Ábrela en Safari, toca Compartir (el cuadro con la flecha) y elige "Agregar a inicio".</div><button class="link" data-act="hideInstall" style="align-self:flex-start;font-size:13px">Ahora no</button>'
      : '<div class="muted small">En Chrome toca ⋮ y luego "Instalar app". Si la abriste desde WhatsApp, primero toca ⋮ y "Abrir en Chrome".</div><button class="link" data-act="hideInstall" style="align-self:flex-start;font-size:13px">Ahora no</button>';
  return '<div class="card" style="gap:8px"><div class="strong">Estás usando Motocaimán desde el navegador</div>' + body + '</div>';
}
function installCard() {
  if (isStandalone()) return '';
  if (installEvt) return '<div class="card" style="flex-direction:row;align-items:center;gap:12px"><img src="' + LOGO + '" alt="" style="width:44px;height:44px;flex-shrink:0"><div class="col grow"><div class="strong">Instala Motocaimán</div><div class="muted small">Ábrela desde un ícono, como cualquier app.</div></div><button class="btn btn-gold btn-sm" data-act="install" style="flex-shrink:0">Instalar</button></div>';
  if (isIOS()) return '<div class="card"><div class="strong">Instala Motocaimán en tu iPhone</div><div class="muted small">En Safari toca el botón Compartir (el cuadro con la flecha) y elige "Agregar a inicio".</div></div>';
  return '';
}

/* ---------- pantallas: acceso ---------- */
function vCargando() { return '<div class="screen"><div class="pad" style="flex:1;justify-content:center;align-items:center"><img src="' + LOGO + '" alt="Logo JNF S.A.S." style="width:96px;height:96px"><div class="spinner" role="status" aria-label="Cargando"></div></div></div>'; }
function vLogin() {
  const crear = S.f.modoCrear;
  return '<div class="screen"><div class="top" style="align-items:center;text-align:center;padding:28px 20px"><img src="' + LOGO + '" alt="Logo JNF S.A.S." style="width:88px;height:88px"><h1 class="h1" style="color:#C9A227">Motocaimán</h1><div class="sub">Tu mototour, al precio que acuerdas.</div></div>' + mascLogin() +
    '<div class="pad">' + errHTML() + bannerHTML(S.banner) +
    '<button class="btn gbtn" data-act="google"' + busyAttr() + '>Entrar con Google</button><div class="divider">o con tu correo</div>' +
    '<div class="field"><label for="em">Correo electrónico</label><input type="email" id="em" data-in="email" autocomplete="email" value="' + fv('email') + '"></div>' +
    '<div class="field"><label for="pw">Contraseña</label><div class="row"><input type="' + (S.showPass ? 'text' : 'password') + '" id="pw" data-in="pass" autocomplete="' + (crear ? 'new-password' : 'current-password') + '" autocapitalize="off" spellcheck="false" value="' + fv('pass') + '"><button class="iconbtn light" style="width:48px;height:48px;border-radius:12px" data-act="togglePass" aria-controls="pw" aria-pressed="' + S.showPass + '" aria-label="' + (S.showPass ? 'Ocultar contraseña' : 'Mostrar contraseña') + '">' + (S.showPass ? I.eyeOff : I.eye) + '</button></div>' + (crear ? '<span class="muted small">Mínimo 6 caracteres.</span>' : '') + '</div>' +
    '<button class="btn btn-gold" data-act="' + (crear ? 'signup' : 'signin') + '"' + busyAttr() + '>' + (crear ? 'Crear cuenta' : 'Ingresar') + '</button>' +
    '<button class="link" data-act="toggleCrear" style="align-self:center">' + (crear ? 'Ya tengo cuenta: ingresar' : 'No tengo cuenta: crear una') + '</button>' +
    (crear ? '' : '<button class="link" data-act="reset" style="align-self:center;font-size:13px">Olvidé mi contraseña</button>') +
    installCard() + '</div><div class="demo">Motocaimán · Versión ' + APP_LABEL + '<br>' + COPY() + '<br><button class="link" data-act="go" data-v="terminos" style="font-size:12px;min-height:32px;text-align:center">Términos y condiciones · Tratamiento de datos</button></div></div>';
}
function vOnboarding() {
  return '<div class="screen"><div class="top">' + brandRow() + '<h1 class="h1">Completa tu perfil</h1><div class="sub">Lo usamos para que conductores y pasajeros se identifiquen.</div></div><div class="pad">' + errHTML() +
    '<div class="field"><label for="on">Nombre y primer apellido</label><input type="text" id="on" data-in="nombre" autocomplete="name" value="' + fv('nombre') + '"></div>' +
    '<div class="field"><label for="ot">Celular</label><input type="tel" id="ot" data-in="telefono" inputmode="numeric" placeholder="10 dígitos" autocomplete="tel" value="' + fv('telefono') + '"></div>' +
    '<label class="check"><input type="checkbox" id="oa" data-in="acepta"' + (S.f.acepta ? ' checked' : '') + '><span>Acepto los términos y condiciones y autorizo a Asesorías y Consultorías JNF S.A.S. el tratamiento de mis datos personales (nombre, celular y ubicación durante los viajes) conforme a la Ley 1581 de 2012, para prestar el servicio de la app.</span></label><button class="link" data-act="go" data-v="terminos" style="align-self:flex-start;font-size:13px">Leer términos y condiciones</button>' +
    '<button class="btn btn-gold" data-act="saveProfile"' + busyAttr() + '>Continuar</button><button class="link" data-act="logout" style="align-self:center">Salir</button></div></div>';
}
/* ---------- pantallas: pasajero ---------- */
function vHome() {
  let gps = '';
  if (S.gps === 'ok') gps = '<div class="muted small">Ubicación GPS detectada. Agrega una referencia para que el conductor te encuentre.</div>';
  else if (S.gps === 'pendiente') gps = '<div class="muted small">Buscando tu ubicación…</div>';
  else gps = gpsBanner();
  let h = '<div class="screen"><div class="row between hdr" style="padding:12px 16px;background:var(--bg)"><button class="iconbtn light" data-act="go" data-v="menu" aria-label="Abrir menú">' + I.menu + '</button>' +
    '<div class="row hpill" style="background:#1A2580;border-radius:28px;padding:4px 16px 4px 4px"><img class="logo" src="' + LOGO + '" alt="Logo JNF S.A.S."><span class="brandname">Motocaimán</span></div>' + (mascBadge() || '<div style="width:44px"></div>') + '</div>' + mascBand();
  h += S.gps === 'ok' ? '<div id="map" class="lmap" role="img" aria-label="Mapa con tu ubicación' + (S.destPin ? ' y el destino' : '') + '"></div>' + legendHTML([['person', 'Tú'], ['otro', 'Conductores cerca']].concat(S.destPin ? [['dest', 'Destino']] : [])) : '';
  h += '<div class="sheet"><div class="handle"></div>' + bannerHTML(S.banner) + errHTML() + mascBig() + mascNotice() + homeInstallCard() + (S.pushUrl && pushPerm() === 'default' ? pushCard(false) : '');
  const env = S.tipo === 'envio';
  h += '<div class="seg2" role="group" aria-label="Tipo de servicio"><button data-act="tipoSrv" data-v="viaje" aria-current="' + !env + '">🛺 Viaje</button><button data-act="tipoSrv" data-v="envio" aria-current="' + env + '">📦 Envío</button></div>';
  h += '<h1 class="h1">' + (env ? '¿Dónde recogemos?' : '¿Dónde estás?') + '</h1>';
  h += '<div class="field"><label for="ref">Punto de recogida (referencia)</label><input type="text" id="ref" data-in="ref" placeholder="Ej. Frente a la tienda azul, Calle 5" value="' + fv('ref') + '">' + gps + '</div>';
  h += '<h2 class="h1" style="margin-top:6px">' + (env ? '¿A dónde lo llevamos?' : '¿A dónde vas?') + '</h2><div class="field"><label for="destino">Destino</label><input type="text" id="destino" data-in="destino" placeholder="Barrio, dirección o lugar" value="' + fv('destino') + '" autocomplete="off">';
  if (S.pickDest) h += '<div class="banner info">' + I.info + '<div class="grow">Toca el mapa en el punto exacto de tu destino.</div><button data-act="pickDest">Cancelar</button></div>';
  else if (S.destPin) h += '<div class="row between" style="flex-wrap:wrap;gap:6px"><span class="muted small">Destino marcado · recorrido estimado: <b data-eta>' + esc(etaText()) + '</b></span><button class="link" data-act="clearDest" style="font-size:13px;min-height:36px">Quitar</button></div>';
  else if (S.gps === 'ok') h += '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))"><button class="btn btn-ghost btn-sm" style="width:100%" data-act="geoDest"' + busyAttr() + '>Ubicar en el mapa</button><button class="btn btn-ghost btn-sm" style="width:100%" data-act="pickDest">Marcar en el mapa</button></div>';
  h += '</div>';
  if (env) {
    h += '<div class="col" style="gap:8px"><span class="lbl" id="lblcont">¿Qué envías?</span><div class="chips" role="group" aria-labelledby="lblcont">' + ENV_CONT.map(x => '<button class="chip" data-act="envCont" data-v="' + x[0] + '" aria-pressed="' + (S.f.envCont === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<div class="field"><label for="edesc">Descripción (opcional)</label><input type="text" id="edesc" data-in="envDesc" maxlength="120" placeholder="Ej. Sobre con papeles de la notaría" value="' + fv('envDesc') + '" autocomplete="off"></div>' +
      '<div class="card" style="gap:10px;background:var(--field)"><div class="h2" style="font-size:15px">¿Quién recibe?</div><div class="field"><label for="rnom">Nombre</label><input type="text" id="rnom" data-in="recNom" maxlength="60" autocomplete="off" value="' + fv('recNom') + '"></div><div class="field"><label for="rtel">Celular</label><input type="tel" id="rtel" data-in="recTel" inputmode="numeric" placeholder="10 dígitos" autocomplete="off" value="' + fv('recTel') + '"></div></div>' +
      '<div class="col" style="gap:8px"><span class="lbl" id="lblpaga">¿Quién paga el envío?</span><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))" role="group" aria-labelledby="lblpaga"><button class="chip" data-act="pagaRecibe" data-v="0" aria-pressed="' + !S.pagaRecibe + '">Pago yo</button><button class="chip" data-act="pagaRecibe" data-v="1" aria-pressed="' + S.pagaRecibe + '">Paga quien recibe</button></div></div>';
  }
  h += '<div class="offerbox"><span class="lbl">Tu oferta</span><div class="stepper"><button class="round" data-act="minus" aria-label="Bajar oferta 500 pesos"' + (S.offer <= MIN ? ' disabled' : '') + '>−</button><div class="amount" id="amount">' + money(S.offer) + '</div><button class="round solid" data-act="plus" aria-label="Subir oferta 500 pesos">+</button></div>' +
    '<div class="row between" style="flex-wrap:wrap;gap:4px"><span class="muted small">Mínimo ' + money(MIN) + ' · sin tope</span><button class="link" data-act="otroToggle" aria-expanded="' + S.otroOpen + '" style="font-size:13px">' + (S.otroOpen ? 'Cerrar' : 'Escribir otro valor') + '</button></div>';
  if (S.otroOpen) h += '<div class="field"><label for="otro">Valor que ofreces</label><div class="row"><input type="text" inputmode="numeric" id="otro" data-in="otroVal" placeholder="Ej. 2.300" value="' + fv('otroVal') + '"><button class="btn btn-navy btn-sm" data-act="otroUse" style="min-height:48px">Usar</button></div>' + (S.f.otroErr ? '<div class="err" role="alert">' + esc(S.f.otroErr) + '</div>' : '') + '</div>';
  h += '</div><div class="col" style="gap:8px"><span class="lbl" id="lblpago">Forma de pago</span><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))" role="group" aria-labelledby="lblpago">' +
    '<button class="chip" data-act="pago" data-v="efectivo" aria-pressed="' + (S.pago === 'efectivo') + '">Efectivo</button><button class="chip" data-act="pago" data-v="transferencia" aria-pressed="' + (S.pago === 'transferencia') + '">Transferencia</button></div></div>' +
    (env ? '' : '<button class="chip" data-act="notaToggle" aria-expanded="' + S.notaOpen + '" style="align-self:flex-start">' + (S.notaOpen ? 'Ocultar nota' : 'Agregar nota al conductor') + '</button>');
  if (S.notaOpen && !env) h += '<div class="field"><label for="nota">Nota para el conductor</label><textarea id="nota" data-in="nota" maxlength="200" placeholder="Ej. Llevo un paquete pequeño">' + fv('nota') + '</textarea></div>';
  const bl = blockOf(S.user.uid, 'pasajero'), rt = rateOf(S.user.uid, 'pasajero');
  if (!bl && rt && rt.pct != null && rt.pct > 15) h += '<div class="banner warn">' + I.info + '<div class="grow">Tu tasa de cancelación es de <b>' + rt.pct + ' %</b>. Si supera el 30 %, tu cuenta pasa a revisión del administrador.</div></div>';
  if (env && !bl) h += '<label class="check"><input type="checkbox" data-in="envOk"' + (S.f.envOk ? ' checked' : '') + '><span>Declaro que el envío no contiene dinero en efectivo, armas, sustancias prohibidas, animales vivos ni objetos ilegales.</span></label>';
  h += bl ? blockCard('pasajero', bl) : '<button class="btn btn-gold" data-act="buscar"' + busyAttr() + '>' + (env ? 'Buscar mototour para envío · ' : 'Buscar mototour · ') + money(S.offer) + '</button>';
  h += '</div></div>';
  return h;
}
function livePos(uid) { const o = S.others && S.others[uid]; return o && o.rol === 'conductor' && typeof o.ts === 'number' && Date.now() - o.ts < 3 * 60 * 1000 ? { lat: o.lat, lng: o.lng } : null; }
function zoneCenter() { return S.screen === 'buscando' ? (pickupOf(S.viaje) || S.pos) : S.screen === 'home' ? S.pos : null; }
function zoneCount() {
  const c = zoneCenter(); if (!c) return 0; const me = S.user && S.user.uid;
  return Object.keys(S.others || {}).filter(uid => { const p = livePos(uid); return uid !== me && p && distKm(c, p) <= RADIO_KM; }).length;
}
function offerEta(o) { const p = livePos(o.id) || (o.lat != null ? { lat: o.lat, lng: o.lng } : null); const km = distKm(p, pickupOf(S.viaje) || S.pos); return km == null ? null : { km, min: etaMin(km) }; }
function vBuscando() {
  const v = S.viaje || {}, n = zoneCount(), no = S.ofertas.length;
  const CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const PIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const OK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
  const chip = (ic, t, attr) => '<span class="row" style="gap:6px;padding:7px 12px;border-radius:12px;background:#1A2580;color:#FFFFFF;font-size:15px;font-weight:800;white-space:nowrap"' + attr + '>' + ic + t + '</span>';
  const env = esEnvio(v);
  let h = '<div class="screen"><div class="top" style="gap:6px">' + (env ? '<div>' + TAG_ENV + '</div>' : '') + '<h1 class="h1">' + (no ? (env ? 'Ofertas para tu envío' : 'Ofertas recibidas') : (env ? 'Buscando conductor para tu envío' : 'Buscando conductores')) + '</h1><div class="sub">Tu oferta: <span style="color:#C9A227;font-weight:800">' + money(v.oferta || S.offer) + '</span> hacia ' + esc(v.destino ? v.destino.texto : '') + ' · ' + pagoTxt(v) + '</div>' +
    '<div class="sub"><span data-count>' + n + '</span> ' + (n === 1 ? 'conductor' : 'conductores') + ' en tu zona · ' + (no ? no + (no === 1 ? ' oferta' : ' ofertas') : 'esperando ofertas') + '</div></div>';
  h += '<div id="map" class="lmap" role="img" aria-label="Mapa con tu ubicación, la zona de búsqueda y los conductores cercanos"></div>' + legendHTML([['person', 'Tú'], ['otro', 'En tu zona'], ['moto', 'Con oferta']]);
  h += '<div class="pad">' + errHTML();
  if (!no) h += '<div class="card" style="flex-direction:row;align-items:center;gap:12px"><div class="spinner" aria-hidden="true" style="flex-shrink:0"></div><div class="col"><div class="strong">Enviamos tu solicitud a los conductores de tu zona' + (env ? ' que aceptan envíos' : '') + '</div><div class="muted small">Las ofertas aparecen aquí y en el mapa a medida que llegan. Mantén esta pantalla abierta.</div></div></div>';
  S.ofertas.forEach(o => {
    const r = S.ratings[o.id], e = offerEta(o), tu = o.precio === v.oferta;
    h += '<div class="card' + (tu ? ' sel' : '') + '"><div class="row"><div class="avatar">' + esc(initials(o.nombre)) + '</div><div class="col grow"><div class="strong">' + esc(o.nombre) + '</div><div class="muted small row" style="gap:6px;flex-wrap:wrap">' + ratingLine(r) + ratePill(o.id, 'conductor') + '</div></div>' +
      '<div class="col" style="align-items:flex-end"><div class="price">' + money(o.precio) + '</div>' + (tu ? '<span class="pill p-warn">Tu precio</span>' : '') + '</div></div>' +
      (e ? '<div class="row" style="gap:8px;flex-wrap:wrap">' + chip(CLOCK, 'Llega en <span data-ofmin="' + esc(o.id) + '">' + e.min + '</span> min', '') + chip(PIN, 'a <span data-ofkm="' + esc(o.id) + '">' + fmtDist(e.km) + '</span>', '') + '</div>' : '<div class="muted small">Ubicación del conductor no disponible.</div>') +
      '<div class="col" style="gap:4px"><div class="muted">' + esc(o.moto) + ' ' + esc(o.color) + ' · Placa ' + esc(o.placa) + '</div>' +
      (o.registro ? '<div class="row small strong" style="gap:6px;color:var(--ok-ink)">' + OK + 'Registro de tránsito N° ' + esc(o.registro) + '</div>' : '') + '</div>' +
      '<button class="btn btn-gold" data-act="accept" data-v="' + esc(o.id) + '" style="min-height:48px;font-size:15px"' + busyAttr() + '>Aceptar ' + money(o.precio) + '</button></div>';
  });
  return h + '<button class="link danger" data-act="cancelTrip" style="align-self:center"' + busyAttr() + '>Cancelar solicitud</button></div></div>';
}
function graceLeft() { const v = S.viaje; return v && v.asignadoEn ? GRACIA_S - (Date.now() - tsMs(v.asignadoEn)) / 1000 : 0; }
function penPasajero(v, motivo) {
  if (motivo === 'inseguro') return null;
  const el = (Date.now() - tsMs(v.asignadoEn)) / 1000;
  if (el < GRACIA_S) return null;
  if (motivo === 'no_llega' && v.estado === 'asignado' && el / 60 > (v.etaMin || 5) + TARDE_EXTRA_MIN) return 'conductor';
  return 'pasajero';
}
function vCancelar() {
  const v = S.viaje || {}, rol = S.cancelRol, m = S.cancel.motivo;
  const quien = rol === 'pasajero' ? (v.conductor ? v.conductor.nombre : '') : v.pasajeroNombre;
  let h = '<div class="screen"><div class="top" style="gap:4px"><h1 class="h1">' + (esEnvio(v) ? 'Cancelar envío' : 'Cancelar viaje') + '</h1><div class="sub">' + esc(quien) + ' · ' + esc(v.destino ? v.destino.texto : '') + ' · ' + money(v.precioFinal || 0) + '</div></div><div class="pad">' + errHTML();
  h += '<h2 class="h2">¿Por qué cancelas?</h2><div class="card" style="gap:0;padding:4px 14px" role="radiogroup" aria-label="Motivo de la cancelación">';
  MOTIVOS[rol].forEach(o => {
    const on = m === o[0];
    h += '<button role="radio" aria-checked="' + on + '" class="menuitem" data-act="motivo" data-v="' + o[0] + '" style="justify-content:flex-start;gap:12px"><span style="width:22px;height:22px;border-radius:11px;border:2px solid var(--ink);display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (on ? '<span style="width:12px;height:12px;border-radius:6px;background:var(--ink)"></span>' : '') + '</span>' + o[1] + '</button>';
  });
  h += '</div>';
  if (m === 'otro') h += '<div class="field"><label for="mt">Escribe el motivo de la cancelación</label><textarea id="mt" data-in="motivoTexto" maxlength="200" placeholder="Cuéntanos qué pasó">' + fv('motivoTexto') + '</textarea></div>';
  const ok = t => '<div class="banner ok">' + I.info + '<div class="grow">' + t + '</div></div>', inf = t => '<div class="banner info">' + I.info + '<div class="grow">' + t + '</div></div>';
  if (rol === 'pasajero') {
    const g = graceLeft();
    if (m === 'inseguro') h += ok('No penaliza. El caso llega a revisión del administrador.');
    else if (g > 0) h += ok('<b>Sin penalización:</b> estás dentro de los 2 minutos de gracia (quedan <span data-timer="gracia">' + fmtClock(g) + '</span>).');
    else if (m === 'no_llega' && penPasajero(v, m) === 'conductor') h += ok('No cuenta en tu tasa: el conductor superó su tiempo de llegada.');
    else h += inf('Esta cancelación contará en tu tasa de cancelación. "Me siento inseguro" nunca penaliza y llega a revisión del administrador.');
  } else {
    h += m === 'inseguro' ? ok('No penaliza. El caso llega a revisión del administrador.') : '<div class="banner warn">' + I.info + '<div class="grow">Esta cancelación contará en tu tasa de cancelación. Si el pasajero no se presentó, espera los 5 minutos en el punto y usa ese botón.</div></div>';
  }
  return h + '<button class="btn btn-danger" data-act="doCancel"' + busyAttr() + '>Cancelar viaje</button><button class="btn btn-ghost" data-act="backFromCancel">Volver al viaje</button></div></div>';
}
function sosBlock() {
  if (S.sos === 'confirm') return '<div class="banner danger" role="alertdialog" aria-label="Confirmar alerta de pánico">' + I.shield + '<div class="grow col" style="gap:10px"><div class="strong">¿Activar la alerta de pánico?</div><div>Se registra una alerta con tu ubicación para el administrador de Motocaimán' + ((S.perfil.contactos || []).length ? ' y podrás avisar a tus contactos por WhatsApp' : '') + '.</div><div class="row"><button class="btn btn-danger btn-sm" data-act="sosSend" style="flex:1;min-height:44px">Activar alerta</button><button class="btn btn-ghost btn-sm" data-act="sosCancel" style="flex:1;min-height:44px">Cancelar</button></div></div></div>';
  if (S.sos === 'sent') {
    const loc = S.pos ? 'https://maps.google.com/?q=' + S.pos.lat + ',' + S.pos.lng : '';
    const txt = encodeURIComponent('Alerta Motocaimán: necesito ayuda durante un viaje en mototour.' + (loc ? ' Mi ubicación: ' + loc : ''));
    const btns = (S.perfil.contactos || []).map(c => '<a class="btn btn-danger btn-sm" style="width:100%;min-height:44px" target="_blank" rel="noopener" href="https://wa.me/57' + esc(c.telefono) + '?text=' + txt + '">Avisar a ' + esc(c.nombre) + ' por WhatsApp</a>').join('');
    return '<div class="banner danger" role="alert">' + I.shield + '<div class="grow col" style="gap:8px"><div><b>Alerta registrada.</b> El administrador de Motocaimán la ve en su panel.</div>' + btns + '</div></div>';
  }
  return '';
}
function vEnvioP() {
  const v = S.viaje || {}, c = v.conductor || {}, st = v.estado, dev = !!v.devolucion, hasDest = !!destOf(v), R = S.recibe || {};
  const sub = st === 'asignado' ? 'El conductor va a recoger tu envío' : st === 'en_punto' ? 'El conductor llegó al punto de recogida' : dev ? 'Tu envío se está devolviendo' : 'Tu envío va en camino';
  const big = st === 'asignado' ? 'Llega en <span data-eta>' + esc(S.drvPos ? etaText() : '…') + '</span>' : st === 'en_punto' ? 'Entrégale el paquete' : dev ? 'De regreso a ti' : hasDest ? 'Llega en <span data-eta>' + esc(etaText()) + '</span>' : 'A ' + esc(v.destino ? v.destino.texto : '');
  let h = '<div class="screen"><div class="top" style="gap:10px"><div class="row between" style="align-items:flex-start"><div class="col" style="gap:6px"><div>' + TAG_ENV + '</div><div class="sub">' + sub + '</div><div class="h1" style="color:#C9A227">' + big + '</div></div><button class="sos" data-act="sos" aria-label="Botón de pánico">SOS</button></div></div>';
  h += '<div id="map" class="lmap" role="img" aria-label="Mapa del envío"></div>' + legendHTML(REC(st) ? [['person', 'Punto de recogida'], ['moto', 'Conductor']] : [['moto', 'Conductor']].concat(dev ? [['dest', 'Devolución']] : hasDest ? [['dest', 'Entrega']] : []));
  h += '<div class="sheet"><div class="handle"></div>' + sosBlock() + errHTML() + bannerHTML(S.banner);
  if (st === 'en_punto') h += '<div class="card" style="align-items:center;gap:6px"><div class="muted small strong">El conductor te espera para recoger el paquete</div><div class="amount" style="line-height:1.25" data-timer="espera">' + fmtClock(ESPERA_S - 10 - (Date.now() - tsMs(v.enPuntoEn)) / 1000) + '</div><div class="bar" style="width:100%"><div data-timerbar="espera" style="width:' + Math.min(100, (Date.now() - tsMs(v.enPuntoEn)) / 3000) + '%;background:#C9A227"></div></div></div>';
  h += '<div class="card"><div class="row"><div class="avatar">' + esc(initials(c.nombre)) + '</div><div class="col grow"><div class="strong">' + esc(c.nombre) + '</div><div class="muted small">' + ratingLine(S.ratings[v.conductorId]) + ' · ' + esc(c.moto) + ' ' + esc(c.color) + ' · ' + esc(c.placa) + '</div></div></div>' + (S.cPhone ? '<a class="btn btn-ghost" href="tel:' + esc(S.cPhone) + '">' + I.phone + 'Llamar al conductor</a>' : '') + '</div>';
  if (S.envCod) {
    const txt = 'Hola ' + (R.nombre || '') + ', te envié un paquete con Motocaimán. Te lo lleva ' + (c.nombre || 'el conductor') + (c.placa ? ' (placa ' + c.placa + ')' : '') + ' a ' + (v.destino ? v.destino.texto : '') + '. Para recibirlo, dale este código: ' + S.envCod + (pagaRec(v) ? '. El envío lo pagas tú: ' + money(v.precioFinal || 0) + '.' : '.');
    h += '<div class="card"><div class="strong">Código de entrega</div><div class="code" aria-label="Código de entrega ' + S.envCod.split('').join(' ') + '">' + S.envCod + '</div>' +
      '<div class="muted small">' + (dev ? 'El envío se devuelve: el conductor te pedirá <b>a ti</b> este código para confirmar la devolución.' : 'Compártelo solo con <b>' + esc(R.nombre || 'quien recibe') + '</b>. El conductor se lo pedirá al entregar; así sabes que llegó a la persona correcta.') + '</div>' +
      (!dev && R.telefono ? '<a class="btn btn-navy" target="_blank" rel="noopener" href="https://wa.me/57' + esc(R.telefono) + '?text=' + encodeURIComponent(txt) + '">Enviar código a ' + esc((R.nombre || '').split(' ')[0] || 'quien recibe') + ' por WhatsApp</a>' : '') + '</div>';
  } else if (S.envCod === null) h += '<div class="spinner" role="status" aria-label="Cargando código de entrega"></div>';
  const paso = (ok, now, n, t) => '<div class="st' + (ok ? ' ok' : now ? ' now' : '') + '"><span class="b">' + (ok ? '✓' : n) + '</span><div class="strong">' + t + '</div></div>';
  h += '<div class="card" style="gap:6px"><div class="steps">' + paso(true, false, 1, 'Conductor asignado') + paso(st === 'en_curso', REC(st), 2, st === 'en_curso' ? 'Paquete recogido' : 'Recoger el paquete') +
    paso(false, st === 'en_curso', 3, dev ? 'Devolviéndolo a ti' + (v.devolucionMotivo ? ' · ' + esc(v.devolucionMotivo) : '') : 'Entregar a ' + esc(R.nombre || 'quien recibe')) + '</div></div>';
  h += '<div class="offerbox" style="gap:8px"><div class="row"><span class="dot"></span>' + esc(v.origen ? v.origen.texto : '') + '</div><div class="row"><span class="sq"></span>' + esc(v.destino ? v.destino.texto : '') + '</div><div class="muted small">' + contTxt(v.envio && v.envio.contenido) + (v.envio && v.envio.desc ? ' · ' + esc(v.envio.desc) : '') + '</div><div class="row between" style="border-top:1px solid var(--line);padding-top:8px"><span class="muted">' + pagoTxt(v) + ' · ' + quienPaga(v) + '</span><span class="strong">' + money(v.precioFinal || 0) + '</span></div></div>';
  if (v.pago === 'transferencia') h += S.cTransfer ? '<div class="banner info">' + I.info + '<div class="grow">Datos para transferir <b>' + money(v.precioFinal || 0) + '</b>: <b>' + esc(S.cTransfer) + '</b>' + (pagaRec(v) ? ' (compártelos con quien recibe).' : '') + '</div></div>' : '<div class="banner warn">' + I.info + '<div class="grow">El conductor no ha registrado datos para transferencia. Acuérdenlo por llamada o paguen en efectivo.</div></div>';
  if (S.pushOk) h += '<div class="banner ok">' + I.info + '<div class="grow">Te avisamos cuando se recoja y cuando se entregue, aunque tengas la app cerrada.</div></div>';
  if (REC(st)) h += '<button class="link danger" data-act="openCancel" style="align-self:center"' + busyAttr() + '>Cancelar envío</button>';
  return h + '</div></div>';
}
function vViaje() {
  if (esEnvio(S.viaje)) return vEnvioP();
  const v = S.viaje || {}, c = v.conductor || {}, st = v.estado;
  const hasDest = !!destOf(v);
  const sub = st === 'en_punto' ? 'Tu conductor llegó' : st === 'asignado' ? 'Tu conductor llega en' : hasDest ? 'Llegas a ' + esc(v.destino.texto) + ' en' : 'Vas en camino a';
  const big = st === 'en_punto' ? 'Sal al punto de recogida' : st === 'asignado' ? '<span data-eta>' + esc(S.drvPos ? etaText() : 'Ubicando al conductor…') + '</span>' : hasDest ? '<span data-eta>' + esc(etaText()) + '</span>' : esc(v.destino ? v.destino.texto : '');
  let h = '<div class="screen"><div class="top" style="gap:10px"><div class="row between"><div class="col"><div class="sub">' + sub + '</div><div class="h1" style="color:#C9A227">' + big + '</div></div><button class="sos" data-act="sos" aria-label="Botón de pánico">SOS</button></div></div>';
  h += '<div id="map" class="lmap tall" role="img" aria-label="Mapa del viaje"></div>' + legendHTML(REC(st) ? [['person', 'Tú'], ['moto', 'Tu conductor'], ['otro', 'Otros conductores']] : [['moto', 'Tu conductor']].concat(hasDest ? [['dest', 'Destino']] : []));
  h += '<div class="sheet"><div class="handle"></div>' + sosBlock() + errHTML() + bannerHTML(S.banner);
  if (st === 'en_punto') h += '<div class="card" style="align-items:center;gap:6px"><div class="muted small strong">Tu conductor te espera</div><div class="amount" style="line-height:1.25" data-timer="espera">' + fmtClock(ESPERA_S - 10 - (Date.now() - tsMs(v.enPuntoEn)) / 1000) + '</div><div class="bar" style="width:100%"><div data-timerbar="espera" style="width:' + Math.min(100, (Date.now() - tsMs(v.enPuntoEn)) / 3000) + '%;background:#C9A227"></div></div></div>' +
    '<div class="banner warn">' + I.info + '<div class="grow">Si no te presentas antes de que termine el tiempo, el conductor podrá cancelar y el viaje contará en tu tasa de cancelación.</div></div>';
  h += '<div class="row"><div class="avatar lg">' + esc(initials(c.nombre)) + '</div><div class="col grow"><div class="strong" style="font-size:16px">' + esc(c.nombre) + '</div><div class="muted">' + ratingLine(S.ratings[v.conductorId]) + '</div><div class="muted">' + esc(c.moto) + ' ' + esc(c.color) + '</div></div><div class="plate">' + esc(c.placa) + '</div></div>';
  h += S.cPhone ? '<a class="btn btn-ghost" href="tel:' + esc(S.cPhone) + '">' + I.phone + 'Llamar al conductor</a>' : '';
  h += '<div class="offerbox" style="gap:8px"><div class="row"><span class="dot"></span>' + esc(v.origen ? v.origen.texto : '') + '</div><div class="row"><span class="sq"></span>' + esc(v.destino ? v.destino.texto : '') + '</div><div class="row between" style="border-top:1px solid var(--line);padding-top:8px"><span class="muted">' + pagoTxt(v) + '</span><span class="strong">' + money(v.precioFinal || 0) + '</span></div></div>';
  if (v.pago === 'transferencia') h += S.cTransfer ? '<div class="banner info">' + I.info + '<div class="grow">Transfiere <b>' + money(v.precioFinal || 0) + '</b> a: <b>' + esc(S.cTransfer) + '</b></div></div>' : '<div class="banner warn">' + I.info + '<div class="grow">El conductor no ha registrado datos para transferencia. Acuérdenlo por llamada o paga en efectivo.</div></div>';
  if (REC(st)) h += '<button class="link danger" data-act="openCancel" style="align-self:center"' + busyAttr() + '>Cancelar viaje</button>';
  return h + '</div></div>';
}
function vCalificar() {
  const v = S.viaje || {}, c = v.conductor || {};
  const env = esEnvio(v);
  let h = '<div class="screen"><div class="top" style="padding-bottom:22px">' + brandRow() + '<div class="sub">' + (env ? (v.devolucion ? 'Envío devuelto · ' : 'Envío entregado · ') : 'Viaje finalizado · ') + money(v.precioFinal || 0) + (v.pago === 'transferencia' ? ' por transferencia' : ' en efectivo') + '</div><h1 class="h1">' + (env ? '¿Cómo estuvo tu envío?' : '¿Cómo estuvo tu viaje?') + '</h1></div><div class="pad">' + errHTML();
  h += '<div class="card" style="align-items:center;text-align:center"><div class="avatar lg">' + esc(initials(c.nombre)) + '</div><div class="col" style="align-items:center"><div class="strong" style="font-size:16px">' + esc(c.nombre) + '</div><div class="muted">' + esc(c.moto) + ' · Placa ' + esc(c.placa) + '</div></div>' + starsHTML(S.rating, 'rate') + '<div class="strong">' + LABELS[S.rating] + '</div></div>';
  h += '<div class="col" style="gap:8px"><span class="lbl">¿Qué destacas del conductor?</span>' + chipsHTML(ASP_C, S.chips, 'chip') + '</div>';
  h += '<div class="field"><label for="com">Comentario (opcional)</label><textarea id="com" data-in="comentario" maxlength="500" placeholder="Cuéntanos más sobre el servicio">' + fv('comentario') + '</textarea></div>';
  return h + '<button class="btn btn-gold" data-act="sendRating"' + busyAttr() + '>Enviar calificación</button><button class="link" data-act="skipRating" style="align-self:center">Ahora no</button></div></div>';
}
/* ---------- menú y secciones ---------- */
function vMenu() {
  const c = S.conductor, st = c ? c.estado : 'ninguno', pOn = S.mode === 'pasajero';
  let h = '<div class="screen"><div class="top">' + brandRow('<button class="iconbtn" data-act="closeMenu" aria-label="Cerrar menú">' + I.close + '</button>') +
    '<div class="row"><div class="avatar" style="background:#FFFFFF;color:#1A2580;width:52px;height:52px;border-radius:26px">' + esc(initials(S.perfil.nombre)) + '</div><div class="col"><div class="strong" style="font-size:16px">' + esc(S.perfil.nombre) + '</div><div class="sub">' + esc(S.user.email || '') + '</div></div></div>';
  h += '<div class="seg" role="group" aria-label="Modo de uso"><button data-act="modeP" aria-current="' + pOn + '">Modo pasajero</button>';
  if (st === 'aprobado') h += '<button data-act="modeC" aria-current="' + (!pOn) + '">Modo conductor</button>';
  else if (st === 'pendiente') h += '<button disabled aria-current="false">' + I.lock + 'En revisión</button>';
  else if (st === 'ninguno') h += '<button data-act="go" data-v="registroC" aria-current="false">' + I.lock + 'Modo conductor</button>';
  else h += '<button disabled aria-current="false">' + I.lock + 'No habilitado</button>';
  h += '</div></div><div class="pad">' + bannerHTML(S.banner) + errHTML() + installCard();
  if (st === 'ninguno') h += '<div class="card"><div class="h2">¿Tienes mototour? Conduce con Motocaimán</div><div class="muted">Regístrate con los datos de tu mototour, tu dirección y tu celular. Sube los documentos que tengas; los que falten los puedes subir después. El administrador revisa y activa tu cuenta.</div><button class="btn btn-gold" data-act="go" data-v="registroC">Registrarme como conductor</button></div>';
  if (st === 'pendiente') h += '<div class="card"><div class="h2">Tu registro está en revisión</div><div class="muted">El administrador está revisando tu registro. Cuando te active, esta opción se habilita sola.</div><button class="btn btn-ghost" data-act="go" data-v="registroC">Ver mis documentos</button></div>';
  if (st === 'rechazado' || st === 'suspendido') h += '<div class="card"><div class="h2">Modo conductor no habilitado</div><div class="muted">Tu cuenta de conductor está ' + st + '. Revisa tus documentos y comunícate con la oficina de JNF S.A.S.</div><button class="btn btn-ghost" data-act="go" data-v="registroC">Ver mis documentos</button></div>';
  if (st === 'aprobado') h += '<div class="card"><div class="row between"><div class="h2">Modo conductor habilitado</div><span class="pill p-ok">Aprobado</span></div><div class="banner warn">' + I.info + '<div class="grow">Tu ubicación se comparte solo mientras la app está abierta y estás conectado.</div></div>' + (pOn ? '<button class="btn btn-gold" data-act="modeC">Conectarme como conductor</button>' : '<button class="btn btn-ghost" data-act="modeP">Volver a modo pasajero</button>') + '</div>';
  const items = [['historial', 'Mis viajes'], ['contactos', 'Contactos de emergencia']];
  if (st === 'aprobado') items.push(['transfer', 'Mis datos para transferencias'], ['micalif', 'Mi calificación como conductor'], ['suscripcion', 'Mi suscripción']);
  if (S.admin) items.push(['admin', 'Panel de administración']);
  if (S.pushUrl) items.push(['notif', 'Notificaciones']);
  items.push(['ayuda', 'Ayuda y soporte'], ['terminos', 'Términos y tratamiento de datos']);
  h += '<nav aria-label="Opciones">' + items.map(it => '<button class="menuitem" data-act="go" data-v="' + it[0] + '">' + it[1] + I.chev + '</button>').join('') +
    '<button class="menuitem" data-act="toggleSnd" aria-pressed="' + soundOn() + '">Sonido y vibración<span class="pill ' + (soundOn() ? 'p-ok' : 'p-info') + '">' + (soundOn() ? 'Activados' : 'Desactivados') + '</span></button></nav>';
  return h + '<button class="link danger" data-act="logout" style="align-self:flex-start">Cerrar sesión</button></div><div class="demo">Motocaimán · Versión ' + APP_LABEL + ' (' + APP_VERSION + ')<br>' + COPY() + '</div></div>';
}
function vHistorial() {
  let h = '<div class="screen">' + subTop('Mis viajes') + '<div class="pad">' + errHTML();
  if (!S.hist) return h + '<div class="spinner" role="status" aria-label="Cargando"></div></div></div>';
  if (!S.hist.length) h += '<div class="card"><div class="strong">Aún no tienes viajes.</div><div class="muted">Tus viajes aparecen aquí cuando terminas uno.</div><button class="btn btn-gold" data-act="modeP">Pedir un mototour</button></div>';
  const lab = { buscando: 'Buscando', asignado: 'Asignado', en_curso: 'En curso', finalizado: 'Finalizado', cancelado: 'Cancelado' };
  S.hist.forEach(v => { h += '<div class="card"><div class="row between"><div class="col"><div class="strong">' + (esEnvio(v) ? '📦 ' : '') + esc(v.destino.texto) + '</div><div class="muted small">' + (esEnvio(v) ? 'Envío · ' : '') + (v._rol === 'conductor' ? 'Como conductor · ' + esc(v.pasajeroNombre) : 'Como pasajero' + (v.conductor ? ' · ' + esc(v.conductor.nombre) : '')) + ' · ' + new Date(tsMs(v.creado)).toLocaleDateString('es-CO') + '</div></div><div class="col" style="align-items:flex-end"><div class="price" style="font-size:18px">' + money(v.precioFinal || v.oferta) + '</div><span class="pill ' + (v.estado === 'finalizado' ? 'p-ok' : v.estado === 'cancelado' ? 'p-warn' : 'p-info') + '">' + (lab[v.estado] || v.estado) + '</span></div></div></div>'; });
  return h + '</div></div>';
}
function vContactos() {
  const cs = S.perfil.contactos || [];
  let h = '<div class="screen">' + subTop('Contactos de emergencia') + '<div class="pad">' + errHTML() + '<div class="muted">Si activas el botón de pánico durante un viaje, podrás avisarles por WhatsApp con tu ubicación.</div>';
  cs.forEach((c, i) => { h += '<div class="card"><div class="row between"><div class="col"><div class="strong">' + esc(c.nombre) + '</div><div class="muted">' + esc(c.telefono) + '</div></div><button class="btn btn-ghost btn-sm" data-act="delContact" data-v="' + i + '"' + busyAttr() + '>Quitar</button></div></div>'; });
  if (cs.length < 5) h += '<div class="card"><div class="h2">Agregar contacto</div><div class="field"><label for="cn">Nombre</label><input type="text" id="cn" data-in="cNombre" value="' + fv('cNombre') + '"></div><div class="field"><label for="cp">Celular</label><input type="tel" inputmode="numeric" id="cp" data-in="cTel" placeholder="10 dígitos" value="' + fv('cTel') + '"></div>' + (S.f.cErr ? '<div class="err" role="alert">' + esc(S.f.cErr) + '</div>' : '') + '<button class="btn btn-navy" data-act="addContact"' + busyAttr() + '>Agregar contacto</button></div>';
  return h + '</div></div>';
}
function vTransfer() {
  return '<div class="screen">' + subTop('Datos para transferencias') + '<div class="pad">' + errHTML() + bannerHTML(S.banner) +
    '<div class="muted">Cuando un pasajero elija pagar por transferencia, verá estos datos durante el viaje. Nadie más puede verlos.</div>' +
    '<div class="field"><label for="tr">Entidad y número</label><input type="text" id="tr" data-in="transferencia" maxlength="80" placeholder="Ej. Nequi 300 123 4567" value="' + fv('transferencia') + '"></div>' +
    '<button class="btn btn-navy" data-act="saveTransfer"' + busyAttr() + '>Guardar datos</button></div></div>';
}
const vTexto = (t, b) => '<div class="screen">' + subTop(t) + '<div class="pad"><div class="card">' + b + '</div></div></div>';
const validDir = s => s.length >= 5 && s.length <= 120;
const cleanTel = v => String(v || '').replace(/\D/g, '');
// Dirección y celular del conductor: van en conductores/{id}/privado/datos (solo los ven el conductor y el administrador)
const privRef = cid => doc(db, 'conductores', cid, 'privado', 'datos');
// Documento de identidad: tipo en conductores/{id}.idTipo; número en privado/datos.idNumero; fotos id1 (frente o página de datos) e id2 (reverso).
const ID_TIPOS = [['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['PPT', 'PPT (Permiso por Protección Temporal)'], ['PA', 'Pasaporte']];
const idNombre = t => (ID_TIPOS.find(x => x[0] === t) || [0, 'Documento de identidad'])[1];
const cleanId = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const idErr = (t, n) => !ID_TIPOS.some(x => x[0] === t) ? 'Elige el tipo de documento de identidad.' : (t === 'CC' ? !/^[0-9]{6,10}$/.test(n) : !/^[A-Z0-9]{4,15}$/.test(n)) ? (t === 'CC' ? 'El número de cédula debe tener entre 6 y 10 dígitos.' : 'Escribe el número del documento (entre 4 y 15 letras o números).') : '';
function docsReq(t) {
  const id = t === 'PA' ? [['id1', 'Pasaporte · página de datos', 'Foto clara de la página con tu foto y tus datos']]
    : [['id1', idNombre(t) + ' · frente', 'Foto clara, sin reflejos, que se lean los datos'], ['id2', idNombre(t) + ' · reverso', 'Parte de atrás del documento']];
  return id.concat(DOCS_C);
}
const ID_DOCS = ['id1', 'id2'];
const idChips = (key, sel, act) => '<div class="chips" role="group" aria-label="Tipo de documento">' + ID_TIPOS.map(x => '<button class="chip" data-act="' + act + '" data-v="' + x[0] + '" aria-pressed="' + (sel === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
const DOCS_C = [['licencia', 'Licencia de conducción', 'Foto clara del documento vigente'], ['foto', 'Foto del conductor', 'Rostro visible, de frente y sin gafas'], ['tarjeta', 'Tarjeta de propiedad', 'Licencia de tránsito del mototour'], ['soat', 'SOAT', 'Póliza vigente del mototour'], ['transito', 'Registro ante la Secretaría de Tránsito', 'Certificado o carné expedido por la Secretaría de Tránsito']];
function vRegistroC() {
  const c = S.conductor, reg = !!c, locked = reg && c.estado === 'aprobado';
  const lab = { pendiente: ['p-warn', 'En revisión'], aprobado: ['p-ok', 'Aprobado'], rechazado: ['p-danger', 'Rechazado'], suspendido: ['p-danger', 'Suspendido'] };
  let h = '<div class="screen">' + subTop(reg ? 'Mis documentos' : 'Registro de conductor') + '<div class="pad">' + errHTML() + bannerHTML(S.banner);
  if (!reg) h += '<div class="banner" style="background:#EDE6FA;color:#4B2A8A">' + I.info + '<div class="grow"><b>Tu primer mes es gratis.</b> Empieza a contar desde el día en que te inscribes.</div></div>';
  const idT = (c && c.idTipo && c.estado === 'aprobado' ? c.idTipo : S.f.idTipo || (c && c.idTipo)) || '';
  const idCard = (titulo, extra) => '<div class="card" style="gap:12px;border:2px solid var(--gold)"><div class="h2">' + titulo + '</div><div class="col" style="gap:8px"><span class="lbl" id="lbid">Tipo de documento</span>' + (c && c.idTipo && c.estado === 'aprobado' ? '<div class="strong">' + esc(idNombre(c.idTipo)) + '</div>' : idChips('idTipo', idT, 'idTipo')) + '</div>' +
    '<div class="field"><label for="rid">Número de documento</label><input type="text" id="rid" data-in="idNum" inputmode="' + (idT === 'CC' ? 'numeric' : 'text') + '" autocapitalize="characters" autocomplete="off" placeholder="' + (idT === 'CC' ? 'Ej. 1082456789' : 'Número como aparece en el documento') + '" value="' + fv('idNum') + '"></div>' +
    '<div class="muted small">Solo lo ven tú y el administrador. No se muestra a los pasajeros.</div>' + (extra || '') + '</div>';
  if (!reg) {
    h += idCard('Documento de identidad');
    h += '<div class="field"><label for="rm">Marca y modelo del mototour</label><input type="text" id="rm" data-in="moto" placeholder="Marca y modelo" value="' + fv('moto') + '"></div>' +
      '<div class="field"><label for="rc">Color</label><input type="text" id="rc" data-in="color" placeholder="Ej. Blanco" value="' + fv('color') + '"></div>' +
      '<div class="field"><label for="rp">Placa</label><input type="text" id="rp" data-in="placa" placeholder="Ej. ABC12D" autocapitalize="characters" value="' + fv('placa') + '"></div>' +
      '<div class="field"><label for="rt">Número de registro de tránsito</label><input type="text" id="rt" data-in="registro" placeholder="Como aparece en el certificado" autocapitalize="characters" value="' + fv('registro') + '"></div>' +
      '<div class="field"><label for="rd">Dirección de residencia</label><input type="text" id="rd" data-in="drvDir" maxlength="120" placeholder="Ej. Calle 5 # 12-30, barrio Centro" autocomplete="street-address" value="' + fv('drvDir') + '"></div>' +
      '<div class="field"><label for="rcel">Celular</label><input type="tel" id="rcel" data-in="drvTel" inputmode="numeric" placeholder="10 dígitos" autocomplete="tel" value="' + fv('drvTel') + '"></div>' +
      '<div class="field"><label for="rref">Código de quien te refirió (opcional)</label><input type="text" id="rref" data-in="drvRef" placeholder="Ej. JNF-ABC12D" autocapitalize="characters" autocomplete="off" value="' + fv('drvRef') + '"><span class="muted small">Si otro conductor te invitó, escribe su código; él recibe un descuento cuando hagas tu primer pago.</span></div>';
  } else {
    const l = lab[c.estado] || ['p-info', c.estado];
    h += '<div class="card"><div class="row between"><div class="col"><div class="strong">' + esc(c.moto) + ' ' + esc(c.color) + '</div><div class="muted small">Placa ' + esc(c.placa) + (c.registro ? ' · Registro de tránsito N° ' + esc(c.registro) : '') + '</div></div><span class="pill ' + l[0] + '">' + l[1] + '</span></div>' +
      (locked ? '<div class="muted small">Tus documentos fueron aprobados y ya no se pueden cambiar.</div>' : '<div class="muted small">Si cambias una foto, se envía de inmediato al administrador.</div>') + '</div>';
    if (S.cpriv === null) h += '<div class="spinner" role="status" aria-label="Cargando datos de contacto"></div>';
    else {
      const faltaId = !c.idTipo || !S.cpriv.idNumero;
      if (faltaId) h += idCard('Documento de identidad', '<div class="banner warn">' + I.info + '<div class="grow">Registra tu documento de identidad y sube la foto más abajo. Luego toca "Guardar mis datos".</div></div>');
      else h += '<div class="card" style="gap:4px"><div class="h2">Documento de identidad</div><div class="strong">' + esc(idNombre(c.idTipo)) + ' N° ' + esc(S.cpriv.idNumero) + '</div><div class="muted small">Si hay un error, pídele al administrador que lo corrija.</div></div>';
      h += '<div class="card"><div class="h2">Mis datos de contacto</div>' + (!S.cpriv.direccion ? '<div class="banner warn">' + I.info + '<div class="grow">Registra tu dirección y tu celular.</div></div>' : '') +
      '<div class="field"><label for="rd">Dirección de residencia</label><input type="text" id="rd" data-in="drvDir" maxlength="120" placeholder="Ej. Calle 5 # 12-30, barrio Centro" autocomplete="street-address" value="' + fv('drvDir') + '"></div>' +
      '<div class="field"><label for="rcel">Celular</label><input type="tel" id="rcel" data-in="drvTel" inputmode="numeric" placeholder="10 dígitos" autocomplete="tel" value="' + fv('drvTel') + '"></div>' +
      '<button class="btn btn-ghost" data-act="saveCpriv"' + busyAttr() + '>' + (faltaId ? 'Guardar mis datos' : 'Guardar datos de contacto') + '</button></div>';
    }
  }
  const REQ = docsReq(idT);
  const faltan = REQ.filter(d => !S.docs[d[0]]).length;
  h += '<span class="lbl">Documentos</span>';
  if (!locked && (!reg || S.docsFor === S.user.uid) && faltan) h += '<div class="banner info">' + I.info + '<div class="grow">' + (reg ? 'Te faltan ' + faltan + ' documento(s). Súbelos cuando los tengas; el administrador también puede adjuntarlos.' : 'Puedes enviar el registro aunque te falte algún documento. Lo subes después, o el administrador lo adjunta, y él activa tu cuenta.') + '</div></div>';
  if (reg && S.docsFor !== S.user.uid) return h + '<div class="spinner" role="status" aria-label="Cargando documentos"></div></div></div>';
  h += '<div class="card" style="gap:0;padding:4px 14px">';
  REQ.forEach(d => {
    const x = S.docs[d[0]], lk = locked && !(ID_DOCS.includes(d[0]) && !x);
    const pill = !x ? '<span style="align-self:flex-start" class="pill p-warn">Falta</span>' : x.estado === 'local' ? '<span style="align-self:flex-start" class="pill p-info">Lista para enviar</span>' : '<span style="align-self:flex-start" class="pill p-ok">Enviada</span>';
    const thumb = x ? '<img src="' + x.img + '" alt="' + d[1] + '" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--line)">' : '<span style="width:52px;height:52px;border-radius:8px;border:1px dashed var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted)">' + I.doc + '</span>';
    const btn = lk ? '' : '<label class="upl">' + (x ? 'Cambiar' : 'Subir') + '<input class="vh" type="file" accept="image/*" data-docup="' + d[0] + '"' + (d[0] === 'foto' ? ' capture="user"' : '') + ' aria-label="' + (x ? 'Cambiar ' : 'Subir ') + d[1] + '"></label>';
    h += '<div class="docrow">' + thumb + '<div class="col grow"><div class="strong" style="font-size:14px">' + d[1] + '</div><div class="muted small">' + d[2] + '</div>' + pill + '</div>' + btn + '</div>';
  });
  h += '</div>';
  if (S.docMsg) h += '<div class="banner info" role="status">' + I.info + '<div class="grow">' + esc(S.docMsg) + '</div></div>';
  if (!reg && idT === 'PA') h += '<div class="banner info">' + I.info + '<div class="grow">Con pasaporte se pide solo la página de datos (sin reverso).</div></div>';
  if (!reg) h += '<button class="btn btn-navy" data-act="saveConductor"' + busyAttr() + '>Enviar registro</button>';
  return h + '</div></div>';
}
// Reduce la foto en el celular (JPEG, máx. 1.280 px) para que quepa en Firestore sin usar Storage
function compressImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      let max = 1280, q = 0.8, out = '';
      for (let i = 0; i < 10; i++) {
        const sc = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
        const cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        out = cv.toDataURL('image/jpeg', q);
        if (out.length < 900000) break;
        if (q > 0.55) q -= 0.1; else max = Math.round(max * 0.8);
      }
      URL.revokeObjectURL(url);
      out.length < 900000 ? res(out) : rej(new Error('La foto es demasiado pesada. Intenta con otra.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen. Intenta con otra foto.')); };
    img.src = url;
  });
}
// Conductores aprobados antes de pedir el documento de identidad: se les avisa que lo registren
async function checkIdFalta() {
  const c = S.conductor; if (!c || c.estado !== 'aprobado') return;
  try {
    const n = (await getCountFromServer(query(collection(db, 'conductores', S.user.uid, 'documentos'), where('tipo', 'in', ID_DOCS)))).data().count;
    let num = true; try { const p = await getDoc(privRef(S.user.uid)); num = !!(p.exists() && p.data().idNumero); } catch (e) { }
    S.idFalta = !c.idTipo || !num || n < (c.idTipo === 'PA' ? 1 : 2);
  } catch (e) { S.idFalta = false; }
  if (S.screen === 'solicitudes') render();
}
async function loadMyDocs() {
  try {
    const qs = await getDocs(collection(db, 'conductores', S.user.uid, 'documentos'));
    const d = {}; qs.docs.forEach(x => { d[x.id] = { img: x.data().img, estado: 'subido' }; });
    Object.keys(S.docs).forEach(k => { if (S.docs[k].estado === 'local') d[k] = S.docs[k]; });
    S.docs = d; S.docsFor = S.user.uid;
    try { const p = await getDoc(privRef(S.user.uid)); S.cpriv = p.exists() ? p.data() : {}; } catch (e) { S.cpriv = {}; }
    if (S.f.drvDir == null || S.f.drvDir === '') S.f.drvDir = S.cpriv.direccion || '';
    if (S.f.drvTel == null || S.f.drvTel === '') S.f.drvTel = S.cpriv.telefono || S.perfil.telefono || '';
    if (!S.f.idNum && S.cpriv.idNumero) S.f.idNum = S.cpriv.idNumero;
    if (S.screen === 'registroC') render();
  } catch (e) { fail(e); }
}
/* ---------- pantallas: conductor ---------- */
function vSolicitudes() {
  const st = S.stats;
  let h = '<div class="screen"><div class="top"><div class="row between"><div class="row"><button class="iconbtn" data-act="go" data-v="menu" aria-label="Abrir menú">' + I.menu + '</button><div class="col"><div class="sub">Hola, ' + esc(S.perfil.nombre.split(' ')[0]) + '</div><h1 class="h1" style="white-space:nowrap">Solicitudes</h1></div></div>' +
    '<button class="toggle ' + (S.online ? 'on' : 'off') + '" data-act="online" aria-pressed="' + S.online + '">' + (S.online ? 'En línea' : 'Desconectado') + '<span class="knob"></span></button></div>' +
    '<div class="grid3"><div class="stat"><span class="k">Viajes hoy</span><span class="v">' + (st ? st.viajes : '…') + '</span></div><div class="stat"><span class="k">Ganado hoy</span><span class="v" style="color:#C9A227">' + (st ? money(st.ganado) : '…') + '</span></div><div class="stat"><span class="k">Calificación</span><span class="v">' + (S.ratings[S.user.uid] ? '★ ' + fmtRating(S.ratings[S.user.uid].avg) : '★ …') + '</span></div></div></div>' + mascBand() + '<div class="pad">' + errHTML() + bannerHTML(S.banner) + (mascOn() && S.masc.opcion !== 'B' ? mascNotice(true) : '');
  const blc = blockOf(S.user.uid, 'conductor'), rtc = rateOf(S.user.uid, 'conductor');
  if (blc) return h + blockCard('conductor', blc) + '</div></div>';
  if (conductorBloqueado()) return h + susAviso() + '</div></div>';
  h += susAviso();
  if (S.idFalta) h += '<div class="banner warn">' + I.info + '<div class="grow"><b>Falta tu documento de identidad.</b> Regístralo y sube la foto; sigues trabajando normal mientras tanto.</div><button data-act="go" data-v="registroC">Subir</button></div>';
  if (rtc && rtc.pct != null && rtc.pct > 10) h += '<div class="banner warn">' + I.info + '<div class="grow">Tu tasa de cancelación es de <b>' + rtc.pct + ' %</b>. Si supera el 20 %, tu cuenta pasa a revisión del administrador.</div></div>';
  if (S.online && S.gps === 'error') h += gpsBanner().replace('<div class="grow">', '<div class="grow"><b>Los pasajeros no te ven en el mapa.</b> ');
  if (S.online) h += pushCard(true);
  const acE = !!(S.conductor && S.conductor.envios);
  h += '<div class="card" style="flex-direction:row;align-items:center;gap:12px"><div class="col grow"><div class="strong">Acepto envíos</div><div class="muted small">' + (acE ? 'Recibes también solicitudes de mensajería. Apágalo cuando lleves pasajeros.' : 'Actívalo para recibir también solicitudes de envío de paquetes.') + '</div></div><button class="swi' + (acE ? ' on' : '') + '" role="switch" aria-checked="' + acE + '" aria-label="Acepto envíos" data-act="envios"' + busyAttr() + '></button></div>';
  if (!S.online) h += '<div class="card"><div class="strong">Estás desconectado.</div><div class="muted">Conéctate para recibir solicitudes de pasajeros. La app debe permanecer abierta.</div><button class="btn btn-gold" data-act="online">Conectarme</button></div>';
  else if (!S.requests.length) h += '<div class="card"><div class="spinner" aria-hidden="true"></div><div class="strong center">Buscando pasajeros…</div><div class="muted center">Las solicitudes aparecen aquí con un sonido. Puedes aceptar el precio o contraofertar.</div></div>';
  if (S.online) S.requests.forEach(r => {
    const o = S.cOtro[r.id] || {}, pr = S.ratings['p_' + r.pasajeroId], km = distKm(S.pos, r.origen), env = esEnvio(r);
    h += '<div class="card' + (env ? ' sel' : '') + '"><div class="row between" style="align-items:flex-start"><div class="col">' + (env ? '<div>' + TAG_ENV + '</div>' : '') + '<div class="strong">' + esc(r.pasajeroNombre) + ' <span class="muted" style="font-weight:500">' + (pr ? '★ ' + fmtRating(pr.avg) : '') + '</span></div>' + ratePill(r.pasajeroId, 'pasajero') + '<div class="muted small">' + (km != null ? 'A ' + fmtDist(km) + ' de ti' : 'Distancia no disponible') + '</div></div><div class="col" style="align-items:flex-end;gap:4px"><div class="price">' + money(r.oferta) + '</div><span class="pill ' + (r.pago === 'transferencia' ? 'p-info' : 'p-ok') + '">' + pagoTxt(r) + '</span></div></div>' + (env ? '<div class="small strong" style="color:var(--ok-ink)">El envío lo ' + quienPaga(r) + '</div>' : '') +
      '<div class="col" style="gap:6px"><div class="row"><span class="dot"></span>' + (env ? 'Recoger: ' : '') + esc(r.origen.texto) + '</div><div class="row"><span class="sq"></span>' + (env ? 'Entregar: ' : '') + esc(r.destino.texto) + '</div>' + (env ? '<div class="muted small">Contenido: <b>' + contTxt(r.envio && r.envio.contenido) + '</b>' + (r.envio && r.envio.desc ? ' · ' + esc(r.envio.desc) : '') + '</div>' : '') + (r.nota ? '<div class="muted small">Nota: ' + esc(r.nota) + '</div>' : '') + '</div>' +
      (pickupOf(r) ? '<button class="btn btn-ghost btn-sm" style="width:100%" data-act="reqMap" data-v="' + r.id + '" aria-expanded="' + (S.reqMap === r.id) + '">' + (S.reqMap === r.id ? 'Ocultar mapa' : env ? 'Ver punto de recogida' : 'Ver ubicación del pasajero') + '</button>' : '<div class="muted small">El pasajero no compartió su GPS; usa la referencia.</div>') +
      (S.reqMap === r.id ? '<div style="border-radius:12px;overflow:hidden;border:1px solid var(--line)"><div id="map" class="lmap" style="height:220px" role="img" aria-label="Mapa con la ubicación del pasajero"></div>' + legendHTML([['person', 'Pasajero'], ['moto', 'Tú']].concat(destOf(r) ? [['dest', 'Destino']] : [])) + '</div>' : '') +
      '<button class="btn btn-gold" data-act="cOffer" data-v="' + r.id + '" data-p="' + r.oferta + '" style="min-height:48px;font-size:15px"' + busyAttr() + '>Aceptar ' + money(r.oferta) + '</button>' +
      '<div class="col" style="gap:6px"><span class="lbl">O contraoferta</span><div class="grid4">' + [500, 1000, 1500].map(d => '<button class="cbtn" data-act="cOffer" data-v="' + r.id + '" data-p="' + (r.oferta + d) + '"' + busyAttr() + '>' + money(r.oferta + d) + '</button>').join('') +
      '<button class="cbtn other" data-act="cOtroToggle" data-v="' + r.id + '" aria-expanded="' + !!o.open + '" aria-label="Escribir otro valor">Otro</button></div></div>';
    if (o.open) h += '<div class="field"><label for="co' + r.id + '">Tu contraoferta</label><div class="row"><input type="text" inputmode="numeric" id="co' + r.id + '" data-in="cOtro" data-id="' + r.id + '" placeholder="Ej. 2.800" value="' + esc(o.val || '') + '"><button class="btn btn-navy btn-sm" data-act="cOtroSend" data-v="' + r.id + '" style="min-height:48px"' + busyAttr() + '>Enviar</button></div>' + (o.err ? '<div class="err" role="alert">' + esc(o.err) + '</div>' : '') + '</div>';
    h += '<button class="link" data-act="cIgnore" data-v="' + r.id + '" style="align-self:center;font-size:13px">Ignorar solicitud</button></div>';
  });
  return h + '</div></div>';
}
function vEspera() {
  const e = S.espera || {};
  let h = '<div class="screen"><div class="top"><h1 class="h1">' + (e.perdida ? 'Solicitud no disponible' : 'Oferta enviada') + '</h1>';
  if (!e.perdida) h += '<div class="sub">Esperando que ' + esc(e.nombre) + ' acepte tu oferta de <span style="color:#C9A227;font-weight:800">' + money(e.precio) + '</span> · ' + pagoTxt(e) + '</div>';
  h += '</div><div class="pad">' + errHTML();
  if (e.perdida) return h + '<div class="card"><div class="strong">El pasajero eligió otra oferta o canceló la solicitud.</div><button class="btn btn-gold" data-act="backToRequests">Ver más solicitudes</button></div></div></div>';
  return h + '<div class="card"><div class="spinner" aria-hidden="true"></div><div class="row"><span class="dot"></span>' + esc(e.origen) + '</div><div class="row"><span class="sq"></span>' + esc(e.destino) + '</div></div><button class="btn btn-ghost" data-act="cWithdraw"' + busyAttr() + '>Retirar oferta</button></div></div>';
}
function vCEnvio() {
  const v = S.viaje || {}, st = v.estado, dev = !!v.devolucion, o = v.origen || {}, live = S.paxPos || pickupOf(v), dst = dev ? pickupOf(v) : destOf(v), target = REC(st) ? live : dst, R = S.recibe || {};
  const q = target ? target.lat + ',' + target.lng : encodeURIComponent(REC(st) || dev ? o.texto : v.destino.texto);
  const waze = target ? 'https://waze.com/ul?ll=' + q + '&navigate=yes' : 'https://waze.com/ul?q=' + q + '&navigate=yes';
  const gm = 'https://www.google.com/maps/dir/?api=1&destination=' + q;
  const sub = st === 'asignado' ? 'Recoge el paquete de' : st === 'en_punto' ? 'Llegaste a recoger el paquete de' : dev ? 'Devuelve el paquete a' : 'Entrega el paquete a';
  const big = REC(st) || dev ? v.pasajeroNombre : (R.nombre || (v.destino ? v.destino.texto : ''));
  let h = '<div class="screen"><div class="top" style="gap:10px"><div class="row between" style="align-items:flex-start"><div class="col" style="gap:6px"><div>' + TAG_ENV + '</div><div class="sub">' + sub + '</div><div class="h1" style="color:#C9A227">' + esc(big) + '</div></div><button class="sos" data-act="sos" aria-label="Botón de pánico">SOS</button></div></div>';
  h += '<div id="map" class="lmap" role="img" aria-label="Mapa del envío"></div>' + legendHTML(REC(st) ? [['moto', 'Tú'], ['person', 'Quien envía'], ['otro', 'Otros conductores']] : [['moto', 'Tú']].concat(dst ? [['dest', dev ? 'Devolución' : 'Entrega']] : [])) + '<div class="sheet"><div class="handle"></div>' + sosBlock() + errHTML() + bannerHTML(S.banner);
  if (st === 'en_punto') { const t = (Date.now() - tsMs(v.enPuntoEn)) / 1000; h += '<div class="card" style="align-items:center;gap:6px"><div class="muted small strong">Quien envía tiene para entregarte el paquete</div><div class="amount" style="line-height:1.25" data-timer="espera">' + fmtClock(ESPERA_S - 10 - t) + '</div><div class="bar" style="width:100%"><div data-timerbar="espera" style="width:' + Math.min(100, t / 3) + '%;background:#C9A227"></div></div></div>'; }
  if (st === 'asignado') h += live ? '<div class="row between"><span class="muted">Ruta hasta el punto de recogida</span><span class="strong" data-eta>' + esc(S.pos ? etaText() : 'Ubicándote…') + '</span></div>' : '<div class="banner warn">' + I.info + '<div class="grow">Quien envía no compartió su GPS. Guíate por la referencia y llámalo.</div></div>';
  if (st === 'en_curso') h += dst ? '<div class="row between"><span class="muted">' + (dev ? 'Ruta de regreso' : 'Ruta hasta la entrega') + '</span><span class="strong" data-eta>' + esc(S.pos ? etaText() : 'Ubicándote…') + '</span></div>' : '<div class="banner warn">' + I.info + '<div class="grow">' + (dev ? 'El punto de recogida no está en el mapa.' : 'La entrega no está marcada en el mapa.') + ' Usa Waze o Google Maps con la dirección.</div></div>';
  const paso = (ok, now, n, t, d) => '<div class="st' + (ok ? ' ok' : now ? ' now' : '') + '"><span class="b">' + (ok ? '✓' : n) + '</span><div class="col"><div class="strong">' + t + '</div>' + (d ? '<div class="muted small">' + d + '</div>' : '') + '</div></div>';
  h += '<div class="card"><div class="steps">' + paso(st === 'en_curso', REC(st), 1, st === 'en_curso' ? 'Paquete recogido' : 'Recoger el paquete', esc(o.texto)) +
    paso(false, st === 'en_curso', 2, dev ? 'Devolver a ' + esc(v.pasajeroNombre) : 'Entregar a ' + esc(R.nombre || 'quien recibe'), esc(dev ? o.texto : v.destino.texto)) + paso(false, false, 3, dev ? 'Devuelto' : 'Entregado') + '</div></div>';
  h += '<div class="row"><div class="avatar">' + esc(initials(v.pasajeroNombre)) + '</div><div class="col grow"><div class="strong">' + esc(v.pasajeroNombre) + '</div><div class="muted small">Quien envía' + (S.ratings['p_' + v.pasajeroId] ? ' · ★ ' + fmtRating(S.ratings['p_' + v.pasajeroId].avg) : '') + '</div><div class="small strong">El envío lo ' + quienPaga(v) + '</div></div><div class="col" style="align-items:flex-end;flex-shrink:0"><span class="muted small">' + cobroTxt(v) + '</span><span class="price">' + money(v.precioFinal || 0) + '</span></div></div>';
  h += '<div class="offerbox" style="gap:8px"><div class="row"><span class="dot"></span>Recoger: ' + esc(o.texto) + '</div><div class="row"><span class="sq"></span>Entregar: ' + esc(v.destino.texto) + '</div><div class="muted small">Contenido: <b>' + contTxt(v.envio && v.envio.contenido) + '</b>' + (v.envio && v.envio.desc ? ' · ' + esc(v.envio.desc) : '') + '</div></div>';
  h += '<div class="row"><a class="btn btn-ghost" style="flex:1" target="_blank" rel="noopener" href="' + waze + '">Navegar con Waze</a><a class="btn btn-ghost" style="flex:1" target="_blank" rel="noopener" href="' + gm + '">Google Maps</a></div>';
  if (st === 'en_curso' && !dev) h += '<div class="card" style="gap:8px"><div class="strong">Quien recibe</div><div class="row between"><div class="col"><div class="strong">' + esc(R.nombre || '…') + '</div><div class="muted small">' + esc(R.telefono || '') + '</div></div>' + (R.telefono ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(R.telefono) + '">' + I.phone + 'Llamar</a>' : '') + '</div></div>';
  if (S.pPhone) h += '<a class="btn btn-ghost" href="tel:' + esc(S.pPhone) + '">' + I.phone + 'Llamar a quien envía</a>';
  if (st === 'asignado') {
    const d = distKm(S.pos, live), cerca = !live || (d != null && d <= 0.1);
    h += '<button class="btn btn-gold" data-act="llegue"' + (S.busy || !cerca ? ' disabled' : '') + '>Llegué al punto</button>' +
      (cerca ? '' : '<div class="muted small center">Se habilita cuando estés a menos de 100 m del punto de recogida' + (d != null ? ' (estás a ' + fmtDist(d) + ')' : '') + '.</div>') +
      '<button class="btn btn-ghost" data-act="cStart"' + busyAttr() + '>Recogí el paquete</button>';
  } else if (st === 'en_punto') {
    const listo = (Date.now() - tsMs(v.enPuntoEn)) / 1000 >= ESPERA_S;
    h += '<button class="btn btn-gold" data-act="cStart"' + busyAttr() + '>Recogí el paquete</button>' +
      '<button class="btn btn-ghost" data-act="noShow" data-noshow' + (S.busy || !listo ? ' disabled' : '') + '>Quien envía no se presentó</button>' +
      '<div class="muted small center">' + (listo ? 'Cancelar por no presentarse no afecta tu tasa de cancelación.' : 'Se habilita al terminar los 5 minutos de espera. No afecta tu tasa de cancelación.') + '</div>';
  } else {
    const cobra = pagaRec(v) && !dev ? '<div class="banner warn">' + I.info + '<div class="grow">Antes de entregar, cobra <b>' + money(v.precioFinal || 0) + '</b> a quien recibe (' + pagoTxt(v).toLowerCase() + ').</div></div>' : '';
    h += '<div class="card" style="gap:10px">' + cobra + '<div class="field"><label for="cod">Código de entrega (te lo dicta ' + (dev ? 'quien envía' : 'quien recibe') + ')</label><input type="text" id="cod" data-in="codEnt" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-describedby="codh" value="' + fv('codEnt') + '" style="font-size:22px;font-weight:800;letter-spacing:8px;text-align:center"></div>' +
      '<button class="btn btn-gold" data-act="cEntregar"' + busyAttr() + '>' + (dev ? 'Confirmar devolución' : 'Confirmar entrega') + '</button><div class="muted small" id="codh">Son 4 dígitos. Sin el código correcto no se puede cerrar el envío.' + (dev ? '' : ' Si quien recibe no está, comunícate con quien envía.') + '</div></div>';
    if (!dev) {
      if (S.devAsk) h += '<div class="card" style="gap:10px;border:2px solid var(--danger)"><div class="strong">Devolver el paquete a quien envía</div><div class="field"><label for="dvm">¿Por qué no pudiste entregar?</label><textarea id="dvm" data-in="devMotivo" maxlength="200" placeholder="Ej. No había nadie y no contesta el celular">' + fv('devMotivo') + '</textarea></div><div class="muted small">Quien envía recibe un aviso. Para cerrar, te dará el mismo código de entrega.</div><div class="row"><button class="btn btn-danger btn-sm" style="flex:1" data-act="cDevolver"' + busyAttr() + '>Devolver</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="devAsk">Seguir con la entrega</button></div></div>';
      else h += '<button class="link danger" data-act="devAsk" style="align-self:center">No pude entregar · Devolver a quien envía</button>';
    }
  }
  if (REC(st)) h += '<button class="link danger" data-act="openCancel" style="align-self:center"' + busyAttr() + '>Cancelar envío</button>';
  return h + '</div></div>';
}
function vCViaje() {
  if (esEnvio(S.viaje)) return vCEnvio();
  const v = S.viaje || {}, st = v.estado, o = v.origen || {}, live = S.paxPos || pickupOf(v), dst = destOf(v), target = REC(st) ? live : dst;
  const q = target ? target.lat + ',' + target.lng : encodeURIComponent(REC(st) ? o.texto : v.destino.texto);
  const waze = target ? 'https://waze.com/ul?ll=' + q + '&navigate=yes' : 'https://waze.com/ul?q=' + q + '&navigate=yes';
  const gm = 'https://www.google.com/maps/dir/?api=1&destination=' + q;
  let h = '<div class="screen"><div class="top" style="gap:10px"><div class="row between"><div class="col"><div class="sub">' + (st === 'en_punto' ? 'Llegaste al punto de' : st === 'asignado' ? 'Recoge a' : 'Lleva a') + '</div><div class="h1" style="color:#C9A227">' + esc(REC(st) ? v.pasajeroNombre : v.destino.texto) + '</div></div><button class="sos" data-act="sos" aria-label="Botón de pánico">SOS</button></div></div>';
  h += '<div id="map" class="lmap" role="img" aria-label="Mapa del viaje"></div>' + legendHTML(REC(st) ? [['moto', 'Tú'], ['person', 'Pasajero'], ['otro', 'Otros conductores']] : [['moto', 'Tú']].concat(dst ? [['dest', 'Destino']] : [])) + '<div class="sheet"><div class="handle"></div>' + sosBlock() + errHTML() + bannerHTML(S.banner);
  if (st === 'en_punto') { const t = (Date.now() - tsMs(v.enPuntoEn)) / 1000; h += '<div class="card" style="align-items:center;gap:6px"><div class="muted small strong">El pasajero tiene para salir</div><div class="amount" style="line-height:1.25" data-timer="espera">' + fmtClock(ESPERA_S - 10 - t) + '</div><div class="bar" style="width:100%"><div data-timerbar="espera" style="width:' + Math.min(100, t / 3) + '%;background:#C9A227"></div></div></div>'; }
  if (st === 'asignado') h += live ? '<div class="row between"><span class="muted">Ruta hasta el pasajero</span><span class="strong" data-eta>' + esc(S.pos ? etaText() : 'Ubicándote…') + '</span></div>' : '<div class="banner warn">' + I.info + '<div class="grow">El pasajero no compartió su GPS. Guíate por la referencia y llámalo.</div></div>';
  if (st === 'en_curso') h += dst ? '<div class="row between"><span class="muted">Ruta hasta el destino</span><span class="strong" data-eta>' + esc(S.pos ? etaText() : 'Ubicándote…') + '</span></div>' : '<div class="banner warn">' + I.info + '<div class="grow">El destino no está marcado en el mapa. Usa Waze o Google Maps con la dirección.</div></div>';
  h += '<div class="row"><div class="avatar">' + esc(initials(v.pasajeroNombre)) + '</div><div class="col grow"><div class="strong">' + esc(v.pasajeroNombre) + '</div><div class="muted small">' + (S.ratings['p_' + v.pasajeroId] ? '★ ' + fmtRating(S.ratings['p_' + v.pasajeroId].avg) + ' como pasajero' : 'Pasajero') + '</div></div><div class="col" style="align-items:flex-end"><span class="muted small">' + cobroTxt(v) + '</span><span class="price">' + money(v.precioFinal || 0) + '</span></div></div>';
  h += '<div class="offerbox" style="gap:8px"><div class="row"><span class="dot"></span>' + esc(o.texto) + '</div><div class="row"><span class="sq"></span>' + esc(v.destino.texto) + '</div>' + (v.nota ? '<div class="muted small">Nota: ' + esc(v.nota) + '</div>' : '') + '</div>';
  h += '<div class="row"><a class="btn btn-ghost" style="flex:1" target="_blank" rel="noopener" href="' + waze + '">Navegar con Waze</a><a class="btn btn-ghost" style="flex:1" target="_blank" rel="noopener" href="' + gm + '">Google Maps</a></div>';
  if (S.pPhone) h += '<a class="btn btn-ghost" href="tel:' + esc(S.pPhone) + '">' + I.phone + 'Llamar al pasajero</a>';
  if (st === 'asignado') {
    const d = distKm(S.pos, live), cerca = !live || (d != null && d <= 0.1);
    h += '<button class="btn btn-gold" data-act="llegue"' + (S.busy || !cerca ? ' disabled' : '') + '>Llegué al punto</button>' +
      (cerca ? '' : '<div class="muted small center">Se habilita cuando estés a menos de 100 m del punto de recogida' + (d != null ? ' (estás a ' + fmtDist(d) + ')' : '') + '.</div>') +
      '<button class="btn btn-ghost" data-act="cStart"' + busyAttr() + '>Recogí al pasajero</button>';
  } else if (st === 'en_punto') {
    const listo = (Date.now() - tsMs(v.enPuntoEn)) / 1000 >= ESPERA_S;
    h += '<button class="btn btn-gold" data-act="cStart"' + busyAttr() + '>Recogí al pasajero</button>' +
      '<button class="btn btn-ghost" data-act="noShow" data-noshow' + (S.busy || !listo ? ' disabled' : '') + '>El pasajero no se presentó</button>' +
      '<div class="muted small center">' + (listo ? 'Cancelar por no presentarse no afecta tu tasa de cancelación.' : 'Se habilita al terminar los 5 minutos de espera. No afecta tu tasa de cancelación.') + '</div>';
  } else h += '<button class="btn btn-gold" data-act="cFinish"' + busyAttr() + '>Finalizar viaje</button>';
  if (REC(st)) h += '<button class="link danger" data-act="openCancel" style="align-self:center"' + busyAttr() + '>Cancelar viaje</button>';
  return h + '</div></div>';
}
function vCCalificar() {
  const v = S.viaje || {};
  const env = esEnvio(v);
  let h = '<div class="screen"><div class="top">' + brandRow() + '<div class="row between" style="align-items:flex-end"><div class="col"><div class="sub">' + (!env ? 'Cobra al pasajero' : pagaRec(v) && !v.devolucion ? 'Cobrado a quien recibe' : 'Cobra a quien envía') + '</div><div class="amount" style="color:#C9A227">' + money(v.precioFinal || 0) + '</div></div><div class="sub" style="text-align:right">' + pagoTxt(v) + '</div></div></div><div class="pad">' + errHTML();
  h += '<div class="card" style="align-items:center;text-align:center"><div class="h2">Califica a ' + (env ? 'quien envía: ' : '') + esc(v.pasajeroNombre) + '</div><div class="muted">Solo los conductores ven la calificación de los pasajeros.</div>' + starsHTML(S.rating, 'rate') + '<div class="strong">' + LABELS[S.rating] + '</div></div>';
  h += '<div class="col" style="gap:8px"><span class="lbl">¿Qué destacas del pasajero?</span>' + chipsHTML(ASP_P, S.chips, 'chip') + '</div>';
  return h + '<button class="btn btn-gold" data-act="cSendRating"' + busyAttr() + '>Enviar y seguir conectado</button><button class="link" data-act="cSkipRating" style="align-self:center">Ahora no</button></div></div>';
}
function vMiCalif() {
  let h = '<div class="screen">' + subTop('Mi calificación') + '<div class="pad">' + errHTML();
  const c = S.cal; if (!c) return h + '<div class="spinner" role="status" aria-label="Cargando"></div></div></div>';
  if (!c.n) return h + '<div class="card"><div class="strong">Aún no tienes calificaciones.</div><div class="muted">Mientras tengas menos de 5, los pasajeros verán la etiqueta "Nuevo" junto a tu nombre.</div></div></div></div>';
  h += '<div class="row" style="align-items:flex-end;gap:12px"><div class="amount" style="font-size:44px;line-height:1.2">' + fmtRating(c.raw) + '</div><div class="muted" style="padding-bottom:6px">★ sobre tus últimas ' + c.n + ' calificaciones</div></div>';
  if (c.n >= 5 && c.raw < 4.5) h += '<div class="banner warn">' + I.info + '<div class="grow">Tu promedio está por debajo de 4,5. Si baja de 4,2, tu cuenta pasa a revisión.</div></div>';
  h += '<div class="card" style="gap:8px">' + [5, 4, 3, 2, 1].map(s => { const n = c.dist[s] || 0; return '<div class="row small"><span class="strong" style="width:26px">' + s + '★</span><div class="bar grow"><div style="width:' + Math.round(n / c.n * 100) + '%"></div></div><span class="muted" style="width:26px;text-align:right">' + n + '</span></div>'; }).join('') + '</div>';
  const coms = c.items.filter(x => x.comentario);
  if (coms.length) { h += '<span class="lbl">Comentarios recientes</span>'; coms.slice(0, 10).forEach(x => { h += '<div class="card" style="gap:8px"><div class="row between small"><span class="strong">★ ' + x.estrellas + ' · Pasajero</span><span class="muted">' + new Date(tsMs(x.creado)).toLocaleDateString('es-CO') + '</span></div><div>' + esc(x.comentario) + '</div></div>'; }); }
  return h + '</div></div>';
}
/* ---------- máscaras de temporada ---------- */
// Cada máscara: mascaras/{id} (datos, lectura pública) y mascaras/{id}/img/data (imagen, se descarga solo la visible).
// Se muestra la programada que esté en sus fechas; si no hay, la activa (respetando sus fechas). Solo una activa a la vez.
const OPC = {
  A: ['Insignia y aviso', 'Logo pequeño arriba y aviso que se puede cerrar.'],
  B: ['Franja de temporada', 'Banda con el logo sobre el mapa, en los colores de la imagen.'],
  C: ['Aviso destacado', 'Logo grande al abrir la app, con mensaje.'],
  D: ['Colores de la temporada', 'La app toma los colores de la imagen.']
};
const MASC_IMG_MAX = 350000; // caracteres del data URL (~260 KB)
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { } };
const enFechas = m => { const t = ymd(new Date()); return (!m.desde || m.desde <= t) && (!m.hasta || t <= m.hasta); };
function mascVigente(list) {
  const prog = list.filter(m => m.estado === 'programada' && m.desde && enFechas(m)).sort((a, b) => b.desde.localeCompare(a.desde));
  if (prog.length) return prog[0];
  return list.find(m => m.estado === 'activa' && enFechas(m)) || null;
}
const fmtYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
function fechasTxt(m) {
  if (m.desde && m.hasta) return 'del ' + fmtYmd(m.desde) + ' al ' + fmtYmd(m.hasta);
  if (m.desde) return 'desde el ' + fmtYmd(m.desde);
  if (m.hasta) return 'hasta el ' + fmtYmd(m.hasta);
  return 'sin fechas';
}
// Colores
const hex2rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
const rgb2hex = c => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const relLum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const r = c.map(f); return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]; };
const contrastW = c => 1.05 / (relLum(c) + 0.05);
const cDist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
// p: color principal (texto blanco encima con contraste ≥ 4,5:1) · a: acento · t: fondo suave
function mascPal(m) {
  const cols = ((m && m.colores) || []).map(hex2rgb);
  if (!cols.length) return { p: '#1A2580', a: '#C9A227', t: '#E4E7F6' };
  let p = cols.find(c => contrastW(c) >= 4.5) || cols.slice().sort((x, y) => contrastW(y) - contrastW(x))[0];
  for (let i = 0; i < 40 && contrastW(p) < 4.6; i++) p = p.map(v => v * 0.92);
  const a = cols.find(c => cDist(c, p) > 90) || [201, 162, 39];
  return { p: rgb2hex(p), a: rgb2hex(a), t: rgb2hex(p.map(v => v + (255 - v) * 0.9)) };
}
// Colores dominantes de la imagen (ignora transparencia, blancos y grises)
function detectColors(img) {
  const n = 80, sc = n / Math.max(img.width || 1, img.height || 1), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round((img.width || n) * sc)); cv.height = Math.max(1, Math.round((img.height || n) * sc));
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, cv.width, cv.height);
  let d; try { d = cx.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return []; }
  const B = {}; let tot = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 160) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn > 225) continue;
    if (mx - mn < 20 && mx > 70) continue;
    const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4), e = B[k] || (B[k] = { n: 0, s: [0, 0, 0] });
    e.n++; e.s[0] += r; e.s[1] += g; e.s[2] += b; tot++;
  }
  const cl = [];
  Object.values(B).sort((x, y) => y.n - x.n).forEach(e => {
    const c = e.s.map(v => v / e.n), near = cl.find(k => cDist(k.c, c) < 60);
    if (near) { near.s = near.s.map((v, i) => v + e.s[i]); near.n += e.n; } else cl.push({ c, n: e.n, s: e.s.slice() });
  });
  return cl.map(k => ({ c: k.s.map(v => v / k.n), n: k.n })).sort((x, y) => y.n - x.n).filter(k => k.n >= tot * 0.03).slice(0, 3).map(k => rgb2hex(k.c));
}
// Reduce la imagen conservando la transparencia (WebP o PNG) para guardarla en Firestore
function prepMaskImage(file) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type || '')) { rej(new Error('El archivo no es una imagen. Usa PNG, JPG, WebP o SVG.')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || img.width || 600, h0 = img.naturalHeight || img.height || 600;
      let max = 800, q = 0.9, out = '';
      const png = /png|svg|gif/.test(file.type);
      for (let i = 0; i < 12; i++) {
        const sc = Math.min(1, max / Math.max(w0, h0)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w0 * sc)); cv.height = Math.max(1, Math.round(h0 * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        out = cv.toDataURL('image/webp', q);
        if (out.indexOf('data:image/webp') !== 0) out = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', q);
        if (out.length <= MASC_IMG_MAX) break;
        if (q > 0.65 && out.indexOf('data:image/png') !== 0) q -= 0.1; else max = Math.round(max * 0.8);
      }
      const colores = detectColors(img);
      URL.revokeObjectURL(url);
      out.length <= MASC_IMG_MAX ? res({ img: out, colores }) : rej(new Error('La imagen es demasiado pesada. Intenta con otra.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen. Intenta con otra.')); };
    img.src = url;
  });
}
// data URL -> URL corta de blob (evita repetir cientos de KB en cada pintado de pantalla)
async function toBlobUrl(dataUrl) { try { const r = await fetch(dataUrl); return URL.createObjectURL(await r.blob()); } catch (e) { return dataUrl; } }
async function loadMasc() {
  try {
    const qs = await getDocs(query(collection(db, 'mascaras'), limit(30)));
    const list = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const m = mascVigente(list);
    if (!m) { S.masc = null; S.mascSrc = null; if (MASC_SCREENS.includes(S.screen)) render(); return; }
    if (S.masc && S.masc.id === m.id && S.masc.iv === m.iv && S.mascSrc) { S.masc = m; if (MASC_SCREENS.includes(S.screen)) render(); return; }
    const key = 'jnfm_mimg_' + m.id + '_' + m.iv;
    let data = lsGet(key);
    if (!data) {
      const d = await getDoc(doc(db, 'mascaras', m.id, 'img', 'data'));
      data = d.exists() ? d.data().img : null;
      if (data) {
        try { Object.keys(localStorage).filter(k => k.indexOf('jnfm_mimg_') === 0).forEach(lsDel); } catch (e) { }
        lsSet(key, data);
      }
    }
    if (!data) { S.masc = null; S.mascSrc = null; return; }
    S.masc = m; S.mascSrc = await toBlobUrl(data);
    if (MASC_SCREENS.includes(S.screen)) render();
  } catch (e) { /* sin máscara: la app sigue normal */ }
}
const MASC_SCREENS = ['login', 'home', 'solicitudes', 'menu'];
const mascOn = () => (S.masc && S.mascSrc ? S.masc : null);
const mascKey = m => 'jnfm_mc_' + m.id + '_' + m.ver;
const mascClosed = m => !!S.mascClosed[mascKey(m)] || !!lsGet(mascKey(m));
const mAlt = m => m.mensaje || 'Imagen de temporada';
const mImg = (src, alt, st) => '<img src="' + src + '" alt="' + esc(alt) + '" style="width:auto;max-width:100%;object-fit:contain;display:block;' + (st || '') + '">';
// Piezas que se muestran en la app
function mascBadge() { const m = mascOn(); if (!m || (m.opcion !== 'A' && m.opcion !== 'D')) return ''; return '<div class="mbadge">' + mImg(S.mascSrc, mAlt(m), 'height:36px;max-width:100%') + '</div>'; }
function mascBand() {
  const m = mascOn(); if (!m || m.opcion !== 'B') return ''; const c = mascPal(m);
  return '<div class="mband" style="background:' + c.t + ';border-top:3px solid ' + c.p + ';border-bottom:3px solid ' + c.a + '">' + mImg(S.mascSrc, mAlt(m), 'height:60px;max-width:' + (m.mensaje ? '38%' : '100%') + ';flex-shrink:0' + (m.mensaje ? '' : ';margin:0 auto')) +
    (m.mensaje ? '<div class="strong" style="color:' + c.p + ';font-size:15px">' + esc(m.mensaje) + '</div>' : '') + '</div>';
}
function mascNotice(force) { // aviso pequeño (opción A, y en la pantalla del conductor para A, C y D)
  const m = mascOn(); if (!m || mascClosed(m) || !(m.opcion === 'A' || force)) return '';
  return '<div class="card mnote" style="flex-direction:row;align-items:center;gap:12px;padding:10px 12px">' + mImg(S.mascSrc, mAlt(m), 'height:52px;max-width:' + (m.mensaje ? '88px' : '70%') + ';flex-shrink:0') +
    '<div class="col grow">' + (m.mensaje ? '<div class="strong">' + esc(m.mensaje) + '</div>' : '') + '</div>' +
    '<button class="iconbtn light" style="border:none;width:40px;height:40px" data-act="mascClose" aria-label="Cerrar aviso de temporada">' + I.close + '</button></div>';
}
function mascBig() {
  const m = mascOn(); if (!m || m.opcion !== 'C' || mascClosed(m)) return ''; const c = mascPal(m);
  return '<div class="card" style="align-items:center;text-align:center;border:2px solid ' + c.p + ';gap:10px">' + mImg(S.mascSrc, mAlt(m), 'height:150px;max-width:100%') +
    (m.mensaje ? '<div class="strong" style="font-size:16px">' + esc(m.mensaje) + '</div>' : '') +
    '<button class="btn btn-ghost btn-sm" style="border:1px solid ' + c.p + '" data-act="mascClose">Cerrar aviso</button></div>';
}
function mascLogin() {
  const m = mascOn(); if (!m) return ''; const c = mascPal(m);
  return '<div class="mlogin">' + mImg(S.mascSrc, mAlt(m), 'height:' + (m.opcion === 'C' ? 150 : 110) + 'px;max-width:100%;margin:0 auto') + (m.mensaje ? '<div class="strong center" style="color:' + c.p + '">' + esc(m.mensaje) + '</div>' : '') + '</div>';
}
// Opción D: colores de la temporada en toda la app (menos en el panel de administración)
function applyMascTheme() {
  const m = mascOn(), on = !!(m && m.opcion === 'D' && S.screen !== 'admin');
  appEl.classList.toggle('masc-d', on);
  if (on) { const c = mascPal(m); appEl.style.setProperty('--m1', c.p); appEl.style.setProperty('--m2', c.a); }
}
// Vista previa en miniatura de cada opción (panel de administración)
function miniPrev(op, src, c) {
  const top = op === 'D' ? c.p : '#F6F4EE', pill = op === 'D' ? '#FFFFFF' : '#1A2580';
  const badge = (op === 'A' || op === 'D') ? '<div style="width:26px;height:20px;border-radius:5px;background:#FFFFFF;border:1px solid #E3DECF;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="' + src + '" alt="" style="max-width:22px;max-height:16px;object-fit:contain"></div>' : '<div style="width:26px"></div>';
  let h = '<div class="mini" aria-hidden="true"><div style="background:' + top + ';height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 8px' + (op === 'D' ? ';border-bottom:3px solid ' + c.a : '') + '"><div style="width:16px;height:16px;border-radius:8px;background:' + (op === 'D' ? 'rgba(255,255,255,.3)' : '#FFFFFF') + ';border:1px solid #E3DECF"></div><div style="width:54px;height:14px;border-radius:7px;background:' + pill + '"></div>' + badge + '</div>';
  if (op === 'B') h += '<div style="background:' + c.t + ';border-top:2px solid ' + c.p + ';border-bottom:2px solid ' + c.a + ';height:36px;display:flex;align-items:center;gap:6px;padding:0 6px"><img src="' + src + '" alt="" style="max-height:28px;max-width:44px;object-fit:contain"><div style="height:5px;width:56px;border-radius:3px;background:' + c.p + '"></div></div>';
  h += '<div style="background:#E7E3D6;height:' + (op === 'B' ? 40 : 56) + 'px"></div><div style="background:#FFFFFF;padding:8px;display:flex;flex-direction:column;gap:6px;flex:1">';
  if (op === 'A') h += '<div style="border:1px solid #E3DECF;border-radius:6px;padding:4px;display:flex;align-items:center;gap:6px"><img src="' + src + '" alt="" style="max-height:22px;max-width:36px;object-fit:contain"><div style="height:4px;width:50px;border-radius:2px;background:#1A2580"></div></div>';
  if (op === 'C') h += '<div style="border:2px solid ' + c.p + ';border-radius:8px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:4px"><img src="' + src + '" alt="" style="max-height:48px;max-width:100%;object-fit:contain"><div style="height:4px;width:60%;border-radius:2px;background:' + c.p + '"></div></div>';
  const hd = op === 'D' ? c.p : '#1A2580';
  h += '<div style="height:6px;width:60%;border-radius:3px;background:' + hd + '"></div><div style="height:12px;border-radius:4px;background:#F1EEE6;border:1px solid #E3DECF"></div><div style="height:12px;border-radius:4px;background:#F1EEE6;border:1px solid #E3DECF"></div>';
  h += '<div style="height:14px;border-radius:5px;background:' + (op === 'D' ? c.p : '#C9A227') + ';margin-top:auto"></div>';
  return h + '</div></div>';
}
function mascEstado(m, vig) {
  const t = ymd(new Date()), fut = m.desde && m.desde > t, past = m.hasta && m.hasta < t;
  if (vig && vig.id === m.id) return '<span class="pill p-ok">Se ve ahora</span>';
  if (m.estado === 'activa') return fut ? '<span class="pill p-info">Activa desde ' + fmtYmd(m.desde) + '</span>' : past ? '<span class="pill p-warn">Vencida</span>' : '<span class="pill p-info">Activa</span>';
  if (m.estado === 'programada') return past ? '<span class="pill p-warn">Vencida</span>' : '<span class="pill p-info">Programada</span>';
  return '<span class="pill" style="background:var(--field);color:var(--muted);border:1px solid var(--line)">Guardada</span>';
}
function admMascaras() {
  const L = S.mascList; if (!L) return '<div class="spinner" role="status" aria-label="Cargando"></div>';
  const vig = mascVigente(L);
  let h = '<div class="muted">Cambia la máscara de la app cuando quieras. Solo una máscara puede estar activa a la vez; las programadas se muestran solas en sus fechas y, mientras estén en sus fechas, reemplazan a la activa.</div><div class="mgrid">';
  L.forEach(m => {
    const th = S.mascThumbs[m.id];
    h += '<div class="card" style="gap:10px"><div class="mthumb">' + (th ? mImg(th, m.nombre, 'height:110px;max-width:100%;margin:0 auto') : '<div class="spinner" aria-hidden="true"></div>') + '</div>' +
      '<div class="row between" style="gap:8px;align-items:flex-start"><div class="strong">' + esc(m.nombre) + '</div>' + mascEstado(m, vig) + '</div>' +
      '<div class="muted small">Opción ' + m.opcion + ' · ' + OPC[m.opcion][0] + ' · ' + fechasTxt(m) + '</div>';
    if (S.mascDel === m.id) h += '<div class="banner danger">' + I.info + '<div class="grow">¿Eliminar la máscara "' + esc(m.nombre) + '"? No se puede deshacer.</div></div><div class="row"><button class="btn btn-danger btn-sm" style="flex:1" data-act="mascDelOk" data-v="' + m.id + '"' + busyAttr() + '>Sí, eliminar</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="mascDel" data-v="">Cancelar</button></div>';
    else h += '<div class="row mact">' + (m.estado === 'activa' ? '<button class="btn btn-ghost btn-sm" style="flex:1" data-act="mascOff" data-v="' + m.id + '"' + busyAttr() + '>Desactivar</button>' : '<button class="btn btn-gold btn-sm" style="flex:1" data-act="mascOnAct" data-v="' + m.id + '"' + busyAttr() + '>Activar</button>') +
      '<button class="btn btn-ghost btn-sm" style="flex:1" data-act="mascEdit" data-v="' + m.id + '">Editar</button><button class="btn btn-ghost btn-sm" style="flex:1;color:var(--danger-text)" data-act="mascDel" data-v="' + m.id + '">Eliminar</button></div>';
    h += '</div>';
  });
  h += '<button class="card mnew" data-act="mascNew"><span class="mplus" aria-hidden="true">+</span><span class="strong">Crear máscara con una imagen</span></button></div>';
  return h;
}
function admMascEdit() {
  const E = S.me || {};
  let h = '<button class="link" data-act="admTab" data-v="mascaras" style="align-self:flex-start">← Volver a mis máscaras</button>';
  h += '<section class="card"><h2 class="h2">1. Adjunta la imagen</h2><div class="row" style="gap:16px;flex-wrap:wrap;align-items:flex-start">';
  h += '<div class="mdrop">' + (E.src ? mImg(E.src, 'Imagen de la máscara', 'height:120px;max-width:100%;margin:auto') : '<span class="muted small center">Sin imagen</span>') + '</div><div class="col" style="gap:8px">';
  if (E.src) h += '<span class="muted small">Colores detectados automáticamente:</span><div class="row" style="flex-wrap:wrap;gap:8px">' + (E.colores.length ? E.colores.map(c => '<span class="row small" style="gap:6px"><span style="width:22px;height:22px;border-radius:6px;background:' + c + ';border:1px solid var(--line);flex-shrink:0"></span>' + c + '</span>').join('') : '<span class="muted small">No se detectaron colores; se usarán los de JNF.</span>') + '</div>';
  else h += '<span class="muted small">PNG con fondo transparente, JPG, WebP o SVG. La app la reduce sola y conserva la transparencia.</span>';
  h += '<label class="upl" style="align-self:flex-start">' + (E.src ? 'Cambiar imagen' : 'Adjuntar imagen') + '<input type="file" accept="image/*" class="vh" data-mascup="1"></label>' + (S.mascMsg ? '<span class="muted small" role="status">' + esc(S.mascMsg) + '</span>' : '') + '</div></div></section>';
  if (E.src) {
    const c = mascPal({ colores: E.colores });
    h += '<section class="card"><div class="row between" style="flex-wrap:wrap;gap:6px"><h2 class="h2">2. Elige cómo se verá</h2><span class="muted small">Opciones generadas con tu imagen y sus colores</span></div><div class="mopts">';
    ['A', 'B', 'C', 'D'].forEach(op => {
      const sel = E.opcion === op;
      h += '<div class="card mopt' + (sel ? ' sel' : '') + '">' + miniPrev(op, E.src, c) + '<div class="strong">' + op + ' · ' + OPC[op][0] + '</div><div class="muted small" style="flex:1">' + OPC[op][1] + '</div>' +
        '<button class="btn btn-sm ' + (sel ? 'btn-gold' : 'btn-ghost') + '" style="width:100%" data-act="mascOpc" data-v="' + op + '" aria-pressed="' + sel + '">' + (sel ? '✓ Seleccionada' : 'Usar esta opción') + '</button></div>';
    });
    h += '</div></section>';
    const dt = 'min-height:48px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:15px;color:var(--ink);background:var(--field);width:100%';
    h += '<section class="card"><h2 class="h2">3. Datos de la máscara</h2><div class="mform">' +
      '<div class="field"><label for="mn">Nombre para tu biblioteca (opcional, no se muestra en la app)</label><input type="text" id="mn" data-in="mNombre" maxlength="40" placeholder="Ej. Plato 400 años" value="' + fv('mNombre') + '"></div>' +
      '<div class="field"><label for="mm">Mensaje para los usuarios (opcional)</label><input type="text" id="mm" data-in="mMensaje" maxlength="90" placeholder="Ej. Celebremos juntos los 400 años" value="' + fv('mMensaje') + '"></div>' +
      '<div class="field"><label for="md">Desde (opcional)</label><input type="date" id="md" data-in="mDesde" value="' + fv('mDesde') + '" style="' + dt + '"></div>' +
      '<div class="field"><label for="mh">Hasta (opcional)</label><input type="date" id="mh" data-in="mHasta" value="' + fv('mHasta') + '" style="' + dt + '"></div></div>' +
      '<div class="muted small">Con fecha inicial y "Guardar sin activar", la máscara queda programada y se muestra sola en esas fechas. Sin fechas, queda activa hasta que la desactives.</div>' +
      '<div class="row" style="flex-wrap:wrap"><button class="btn btn-gold btn-sm" style="flex:1;min-height:48px" data-act="mascSave" data-v="1"' + busyAttr() + '>Guardar y activar</button><button class="btn btn-ghost btn-sm" style="flex:1;min-height:48px" data-act="mascSave" data-v="0"' + busyAttr() + '>Guardar sin activar</button></div></section>';
  }
  return h;
}
// Explica al administrador si la máscara que activó/guardó no es la que se ve hoy
function mascAviso(id) {
  const L = S.mascList || [], m = L.find(x => x.id === id), vig = mascVigente(L); if (!m) return;
  if (m.estado === 'activa' && vig && vig.id !== id) S.banner = { kind: 'info', text: '"' + m.nombre + '" está activa, pero hoy se ve la programada "' + vig.nombre + '" (' + fechasTxt(vig) + '). Al terminar esas fechas se verá "' + m.nombre + '".' };
  render();
}
async function loadMascAdmin() {
  try {
    const qs = await getDocs(query(collection(db, 'mascaras'), limit(30)));
    const ord = { activa: 0, programada: 1, guardada: 2 };
    S.mascList = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (ord[a.estado] - ord[b.estado]) || String(a.nombre).localeCompare(String(b.nombre)));
    if (S.screen === 'admin') render();
    for (const m of S.mascList) {
      if (S.mascThumbs[m.id] && S.mascThumbs[m.id + ':iv'] === m.iv) continue;
      try { const d = await getDoc(doc(db, 'mascaras', m.id, 'img', 'data')); if (d.exists()) { S.mascThumbs[m.id] = await toBlobUrl(d.data().img); S.mascThumbs[m.id + ':iv'] = m.iv; S.mascImgData[m.id] = d.data().img; } } catch (e) { }
      if (S.screen === 'admin') render();
    }
  } catch (e) { fail(e); }
}
/* ---------- panel de administración ---------- */
const isWide = () => window.innerWidth >= 900;
const pendientes = () => (S.adm.conductores || []).filter(c => c.estado === 'pendiente').length;
const ADM_SECS = () => [['resumen', 'Resumen'], ['usuarios', 'Usuarios'], ['conductores', 'Conductores' + (pendientes() ? ' (' + pendientes() + ')' : '')], ['viajes', 'Viajes'], ['alertas', 'Alertas de pánico' + (S.adm.alertas && S.adm.alertas.length ? ' (' + S.adm.alertas.length + ')' : '')], ['suscripciones', 'Suscripciones'], ['ingresos', 'Ingresos'], ['mascaras', 'Máscaras'], ['notificaciones', 'Notificaciones']];
function vAdmin() {
  const t = S.admTab, secs = ADM_SECS(), title = t === 'detalle' ? 'Servicios e ingresos' : t === 'susFicha' ? 'Suscripción del conductor' : t === 'tarifas' ? 'Tarifas y referidos' : t === 'mascEdit' ? (S.me && S.me.id ? 'Editar máscara' : 'Crear máscara') : (secs.find(x => x[0] === t) || secs[0])[1].replace(/ \(\d+\)$/, '');
  if (isWide()) {
    return '<div class="adm-wrap"><nav class="adm-side" aria-label="Secciones del panel"><div class="row" style="gap:12px;padding:0 8px 20px"><img src="' + LOGO + '" alt="Logo JNF S.A.S." style="width:52px;height:52px"><div class="col" style="gap:2px"><span class="brandname" style="font-size:18px">Motocaimán</span><span class="small" style="color:#D8DEE8;font-weight:600">Administración</span></div></div>' +
      secs.map(x => '<button data-act="admTab" data-v="' + x[0] + '" aria-current="' + (t === x[0] || (t === 'detalle' && x[0] === S.admBack) || (t === 'mascEdit' && x[0] === 'mascaras') || ((t === 'susFicha' || t === 'tarifas') && x[0] === 'suscripciones')) + '">' + x[1] + '</button>').join('') +
      '<button data-act="go" data-v="menu" style="margin-top:auto">← Volver a la app</button><div style="font-size:11px;color:#B8C0E6;line-height:1.4;padding:8px 12px 0">' + COPY() + '</div></nav>' +
      '<main class="adm-main"><div class="row between" style="flex-wrap:wrap;gap:8px"><h1 class="h1" style="font-size:28px">' + title + '</h1><span class="muted">Hoy · ' + new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</span></div>' +
      errHTML() + bannerHTML(S.banner) + admBody(t) + '</main></div>';
  }
  return '<div class="screen">' + subTop('Administración') + '<div class="pad">' + errHTML() + bannerHTML(S.banner) + '<div class="tabs" role="group" aria-label="Secciones">' +
    secs.map(x => '<button data-act="admTab" data-v="' + x[0] + '" aria-current="' + (t === x[0] || (t === 'mascEdit' && x[0] === 'mascaras') || ((t === 'susFicha' || t === 'tarifas') && x[0] === 'suscripciones')) + '">' + x[1].replace('Alertas de pánico', 'Alertas') + '</button>').join('') + '</div>' + admBody(t) + '</div></div>';
}
function admBody(t) {
  const A = S.adm;
  let h = '';
  if (t === 'resumen') {
    const K = S.admKpi, V = A.viajes, AL = A.alertas, C = A.conductores, wide = isWide();
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const hoy = V ? V.filter(v => v.estado === 'finalizado' && tsMs(v.finalizadoEn || v.creado) >= d0.getTime()).length : null;
    const enLinea = Object.keys(S.others || {}).filter(u => livePos(u)).length;
    const kpi = (label, val, kind) => '<div class="card kpi' + (kind ? ' ' + kind : '') + '"><span class="k">' + label + '</span><span class="v">' + (val == null ? '…' : val) + '</span></div>';
    h += '<div class="kpis">' + kpi('Viajes finalizados hoy', hoy) + kpi('Conductores en línea', enLinea) + kpi('Alertas de pánico activas', AL ? AL.length : null, AL && AL.length ? 'alert' : '') + kpi('Personas registradas', K && K.total, 'navy') + '</div>';
    const pend = C ? C.filter(c => c.estado === 'pendiente') : null;
    let tbl = '';
    if (!pend) tbl = '<div class="spinner" role="status" aria-label="Cargando"></div>';
    else if (!pend.length) tbl = '<div class="muted">No hay conductores pendientes de aprobación.</div>';
    else {
      const docs = c => { const N = docsReq(c.idTipo).length, n = S.admDocCount[c.id] == null ? null : Math.min(S.admDocCount[c.id], N); return n == null ? '<span class="pill p-info">…</span>' : '<span class="pill ' + (n >= N ? 'p-ok' : 'p-warn') + '">' + n + ' de ' + N + '</span>'; };
      const btn = c => '<button class="btn btn-ghost btn-sm" data-act="admReview" data-v="' + c.id + '">Revisar</button>';
      tbl = wide ? '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th scope="col">Conductor</th><th scope="col">Mototour / placa</th><th scope="col">Documentos</th><th scope="col">Acción</th></tr></thead><tbody>' +
        pend.map(c => '<tr><td class="strong">' + esc(c.nombre) + '</td><td>' + esc(c.moto) + ' · ' + esc(c.placa) + '</td><td>' + docs(c) + '</td><td>' + btn(c) + '</td></tr>').join('') + '</tbody></table></div>'
        : pend.map(c => '<div class="row between" style="gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><div class="col"><span class="strong">' + esc(c.nombre) + '</span><span class="muted small">' + esc(c.moto) + ' · ' + esc(c.placa) + '</span>' + docs(c) + '</div>' + btn(c) + '</div>').join('');
    }
    let al = '';
    if (!AL) al = '<div class="spinner" role="status" aria-label="Cargando"></div>';
    else if (!AL.length) al = '<div class="empty">' + I.shield + '<div class="strong">Sin alertas activas</div><div class="muted small">Cada alerta muestra ubicación, persona y hora.</div></div>';
    else al = AL.map(x => '<div class="col" style="gap:6px;padding:10px 0;border-bottom:1px solid var(--line)"><div class="row between" style="gap:8px"><span class="strong">' + esc(x.nombre) + '</span><span class="pill p-danger">Activa</span></div><span class="muted small">' + esc(x.rol) + ' · ' + new Date(tsMs(x.creado)).toLocaleString('es-CO') + '</span><div class="row">' + (x.lat != null ? '<a class="btn btn-ghost btn-sm" style="flex:1" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + x.lat + ',' + x.lng + '">Ver ubicación</a>' : '') + '<button class="btn btn-gold btn-sm" style="flex:1" data-act="admAlert" data-v="' + x.id + '"' + busyAttr() + '>Marcar atendida</button></div></div>').join('');
    h += '<div class="adm-cols"><section class="card"><h2 class="h2">Conductores por aprobar</h2>' + tbl + '</section><section class="card"><h2 class="h2">Alertas de pánico</h2>' + al + '</section></div>';
  }
  if (t === 'conductores') {
    const L = A.conductores; if (!L) return h + '<div class="spinner" role="status" aria-label="Cargando"></div>';
    const lab = { pendiente: ['p-warn', 'Pendiente'], aprobado: ['p-ok', 'Aprobado'], rechazado: ['p-danger', 'Rechazado'], suspendido: ['p-danger', 'Suspendido'] };
    if (!L.length) h += '<div class="card"><div class="muted">Aún no hay conductores registrados.</div></div>';
    const fl = admDrvFiltrados(L);
    h += admDrvFiltros(L.length, fl.length);
    fl.forEach(c => {
      const l = lab[c.estado] || ['p-info', c.estado];
      const REQ = docsReq(c.idTipo), open = S.admOpen === c.id, dl = S.admDocs[c.id], nDocs = dl && dl !== 'cargando' ? REQ.filter(d => dl[d[0]]).length : null;
      h += '<div class="card"><div class="row between"><div class="col"><div class="strong">' + esc(c.nombre) + '</div><div class="muted small">' + esc(c.moto) + ' ' + esc(c.color) + ' · Placa ' + esc(c.placa) + '</div><div class="small strong">' + (c.registro ? 'Registro de tránsito N° ' + esc(c.registro) : 'Sin número de registro de tránsito') + '</div></div><span class="pill ' + l[0] + '">' + l[1] + '</span></div>' + admDrvRating(c) +
        '<div class="row"><button class="btn btn-ghost btn-sm" style="flex:1" data-act="admDocs" data-v="' + c.id + '" aria-expanded="' + open + '">' + (open ? 'Ocultar documentos' : 'Ver documentos') + '</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="admDriver" data-v="' + c.id + '">Servicios e ingresos</button></div>';
      if (open) {
        if (!dl || dl === 'cargando') h += '<div class="spinner" role="status" aria-label="Cargando documentos"></div>';
        else {
          h += '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + REQ.map(d => {
            const x = dl[d[0]], big = S.admBig === c.id + ':' + d[0];
            const up = '<label class="upl" style="min-height:36px;align-self:flex-start">' + (x ? 'Cambiar' : 'Adjuntar') + '<input class="vh" type="file" accept="image/*" data-admdocup="' + c.id + ':' + d[0] + '" aria-label="' + (x ? 'Cambiar ' : 'Adjuntar ') + d[1] + ' de ' + esc(c.nombre) + '"></label>';
            return '<div class="col" style="gap:4px' + (big ? ';grid-column:1 / -1' : '') + '"><span class="small strong">' + d[1] + '</span>' + (x ? '<button data-act="admBig" data-v="' + c.id + ':' + d[0] + '" aria-label="' + (big ? 'Reducir ' : 'Ampliar ') + d[1] + '" style="padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--field)"><img src="' + x + '" alt="' + d[1] + ' de ' + esc(c.nombre) + '" style="width:100%;' + (big ? 'height:auto' : 'height:110px;object-fit:cover') + ';display:block"></button>' : '<div class="pill p-danger" style="align-self:flex-start">Falta</div>') + up + '</div>';
          }).join('') + '</div>';
          if (S.admDocMsg && S.admDocMsg.indexOf(c.id + '|') === 0) h += '<div class="banner info" role="status">' + I.info + '<div class="grow">' + esc(S.admDocMsg.split('|')[1]) + '</div></div>';
          const pv = S.admPriv[c.id];
          if (S.admEdit === c.id) {
            h += '<div class="col" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><div class="strong small">Datos del conductor</div>' +
              '<div class="field"><label for="em' + c.id + '">Marca y modelo del mototour</label><input type="text" id="em' + c.id + '" data-in="aeMoto" value="' + fv('aeMoto') + '"></div>' +
              '<div class="field"><label for="ec' + c.id + '">Color</label><input type="text" id="ec' + c.id + '" data-in="aeColor" value="' + fv('aeColor') + '"></div>' +
              '<div class="field"><label for="ep' + c.id + '">Placa</label><input type="text" id="ep' + c.id + '" data-in="aePlaca" autocapitalize="characters" value="' + fv('aePlaca') + '"></div>' +
              '<div class="field"><label for="er' + c.id + '">Número de registro de tránsito (opcional)</label><input type="text" id="er' + c.id + '" data-in="aeReg" autocapitalize="characters" value="' + fv('aeReg') + '"></div>' +
              '<div class="col" style="gap:6px"><span class="lbl">Tipo de documento de identidad</span>' + idChips('aeIdTipo', S.f.aeIdTipo, 'aeIdTipo') + '</div>' +
              '<div class="field"><label for="ei' + c.id + '">Número de documento</label><input type="text" id="ei' + c.id + '" data-in="aeIdNum" autocapitalize="characters" autocomplete="off" value="' + fv('aeIdNum') + '"></div>' +
              '<div class="field"><label for="ed' + c.id + '">Dirección de residencia</label><input type="text" id="ed' + c.id + '" data-in="aeDir" maxlength="120" value="' + fv('aeDir') + '"></div>' +
              '<div class="field"><label for="et' + c.id + '">Celular</label><input type="tel" id="et' + c.id + '" data-in="aeTel" inputmode="numeric" placeholder="10 dígitos" value="' + fv('aeTel') + '"></div>' +
              '<div class="row"><button class="btn btn-gold btn-sm" style="flex:1" data-act="admEditSave" data-v="' + c.id + '"' + busyAttr() + '>Guardar datos</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="admEdit" data-v="">Cancelar</button></div></div>';
          } else {
            h += '<div class="col" style="gap:2px;border-top:1px solid var(--line);padding-top:10px"><span class="small"><b>Documento:</b> ' + (pv ? (c.idTipo && pv.idNumero ? esc(idNombre(c.idTipo)) + ' N° ' + esc(pv.idNumero) : '<span class="pill p-warn">Sin registrar</span>') : '…') + '</span><span class="small"><b>Dirección:</b> ' + (pv ? (pv.direccion ? esc(pv.direccion) : '<span class="pill p-warn">Sin registrar</span>') : '…') + '</span><span class="small"><b>Celular:</b> ' + (pv ? (pv.telefono ? esc(pv.telefono) : '<span class="pill p-warn">Sin registrar</span>') : '…') + '</span></div>' +
              '<button class="btn btn-ghost btn-sm" style="width:100%" data-act="admEdit" data-v="' + c.id + '">Editar datos del conductor</button>';
          }
        }
      }
      const canApprove = nDocs === REQ.length;
      const incompleto = nDocs !== null && !canApprove;
      if (c.estado !== 'aprobado' && nDocs === null) h += '<div class="muted small">Revisa los documentos antes de aprobar.</div>';
      if (c.estado !== 'aprobado' && incompleto) h += '<div class="muted small">Faltan ' + (REQ.length - nDocs) + ' documento(s).</div>' +
        '<label class="check"><input type="checkbox" data-in="force_' + c.id + '"' + (S.f['force_' + c.id] ? ' checked' : '') + '><span>Confirmo que verifiqué al conductor y lo apruebo sin documentos completos.</span></label>';
      if (c.aprobadoSinDocs) h += '<span class="pill p-warn" style="align-self:flex-start">Aprobado sin documentos completos</span>';
      h += '<div class="row">' +
        (c.estado !== 'aprobado' ? (incompleto ? '<button class="btn btn-gold btn-sm" style="flex:1" data-act="admForce" data-v="' + c.id + '"' + (S.busy || !S.f['force_' + c.id] ? ' disabled' : '') + '>Aprobar sin documentos completos</button>'
          : '<button class="btn btn-gold btn-sm" style="flex:1" data-act="admSet" data-v="' + c.id + '" data-p="aprobado"' + (S.busy || !canApprove ? ' disabled' : '') + '>Aprobar</button>') : '') +
        (c.estado === 'pendiente' ? '<button class="btn btn-ghost btn-sm" style="flex:1" data-act="admSet" data-v="' + c.id + '" data-p="rechazado"' + busyAttr() + '>Rechazar</button>' : '') +
        (c.estado === 'aprobado' ? '<button class="btn btn-ghost btn-sm" style="flex:1" data-act="admSet" data-v="' + c.id + '" data-p="suspendido"' + busyAttr() + '>Suspender</button>' : '') + '</div></div>';
    });
  }
  if (t === 'detalle') {
    const c = (A.conductores || []).find(x => x.id === S.admDriver);
    h += '<button class="link" data-act="admTab" data-v="' + S.admBack + '" style="align-self:flex-start">← Volver a ' + (S.admBack === 'usuarios' ? 'usuarios' : 'conductores') + '</button>';
    if (!c) return h + '<div class="card"><div class="muted">No se encontró el conductor.</div></div>';
    h += '<div class="card"><div class="row between" style="flex-wrap:wrap;gap:8px"><div class="col"><div class="h2">' + esc(c.nombre) + '</div><div class="muted small">' + esc(c.moto) + ' ' + esc(c.color) + ' · Placa ' + esc(c.placa) + (c.registro ? ' · Registro de tránsito N° ' + esc(c.registro) : '') + '</div></div><span class="pill ' + (c.estado === 'aprobado' ? 'p-ok' : 'p-warn') + '">' + esc(c.estado) + '</span></div></div>';
    h += '<div class="card"><div class="h2">Periodo a revisar</div><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
      '<div class="field"><label for="fi">Fecha inicial</label><input type="date" id="fi" data-in="admIni" value="' + fv('admIni') + '" style="min-height:48px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:15px;color:var(--ink);background:var(--field);width:100%"></div>' +
      '<div class="field"><label for="ff">Fecha final</label><input type="date" id="ff" data-in="admFin" value="' + fv('admFin') + '" style="min-height:48px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:15px;color:var(--ink);background:var(--field);width:100%"></div></div>' +
      '<div class="chips">' + [['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior']].map(x => '<button class="chip" data-act="admRango" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
      '<button class="btn btn-navy" data-act="admConsultar"' + busyAttr() + '>Consultar</button></div>';
    const T = S.admTrips[c.id];
    if (!T || T === 'cargando') return h + '<div class="spinner" role="status" aria-label="Cargando servicios"></div>';
    const r = S.admRes;
    if (!r) return h;
    h += '<div class="muted small">Del ' + esc(r.iniTxt) + ' al ' + esc(r.finTxt) + '</div>';
    const kpi = (label, val, kind) => '<div class="card kpi' + (kind ? ' ' + kind : '') + '"><span class="k">' + label + '</span><span class="v">' + val + '</span></div>';
    h += '<div class="kpis">' + kpi('Servicios prestados', r.fin.length) + kpi('Ingresos recibidos', money(r.total), 'navy') + kpi('Promedio por servicio', r.fin.length ? money(Math.round(r.total / r.fin.length)) : '$0') + kpi('Cancelados por el conductor', r.canc) + '</div>';
    h += '<div class="card" style="gap:6px"><div class="row between"><span class="muted">Efectivo</span><span class="strong">' + money(r.ef) + '</span></div><div class="row between"><span class="muted">Transferencia</span><span class="strong">' + money(r.tr) + '</span></div><div class="muted small">Es lo que el conductor cobró a sus pasajeros. La plataforma no cobra comisión por viaje.</div></div>';
    if (!r.fin.length) return h + '<div class="card"><div class="muted">No hay servicios finalizados en ese periodo.</div></div>';
    h += '<button class="btn btn-ghost" data-act="admCsv">Descargar en Excel (CSV)</button>';
    if (isWide()) h += '<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th scope="col">Fecha</th><th scope="col">Pasajero</th><th scope="col">Destino</th><th scope="col">Pago</th><th scope="col" style="text-align:right">Valor</th></tr></thead><tbody>' +
      r.fin.map(v => '<tr><td>' + fmtFecha(r.ts(v)) + '</td><td>' + esc(v.pasajeroNombre) + '</td><td>' + esc(v.destino ? v.destino.texto : '') + '</td><td>' + pagoTxt(v) + '</td><td style="text-align:right" class="strong">' + money(v.precioFinal || 0) + '</td></tr>').join('') + '</tbody></table></div>';
    else r.fin.forEach(v => { h += '<div class="card" style="gap:4px"><div class="row between"><span class="strong">' + esc(v.destino ? v.destino.texto : '') + '</span><span class="strong">' + money(v.precioFinal || 0) + '</span></div><div class="muted small">' + fmtFecha(r.ts(v)) + ' · ' + esc(v.pasajeroNombre) + ' · ' + pagoTxt(v) + '</div></div>'; });
  }
  if (t === 'usuarios') {
    const K = S.admKpi, U = S.admUsers;
    const kpi = (k, v) => '<div class="card" style="gap:2px;padding:12px"><span class="muted small">' + k + '</span><span class="price" style="font-size:24px">' + (v == null ? '…' : v) + '</span></div>';
    const enLinea = Object.keys(S.others || {}).filter(u => livePos(u)).length;
    h += '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + kpi('Personas registradas', K && K.total) + kpi('Conductores en línea ahora', enLinea) + kpi('Conductores aprobados', K && K.aprob) + kpi('Conductores pendientes', K && K.pend) + '</div>';
    const cmap = {}; (A.conductores || []).forEach(c => { cmap[c.id] = c; });
    const uq = fold(S.f.admUQ).trim(), ut = S.f.admUTipo || '', filtro = !!(uq || ut);
    h += '<section class="card" style="gap:10px"><div class="field"><label for="auq">Buscar persona (nombre, celular o placa)</label><input type="text" id="auq" data-in="admUQ" data-live="1" placeholder="Ej. María o 300 123 4567" value="' + fv('admUQ') + '" autocomplete="off"></div><div class="chips">' +
      fchip('admUTipo', '', 'Todos') + fchip('admUTipo', 'pas', 'Pasajeros') + fchip('admUTipo', 'aprob', 'Conductores aprobados') + fchip('admUTipo', 'pend', 'Conductores pendientes') + fchip('admUTipo', 'susp', 'Suspendidos o rechazados') + fchip('admUTipo', 'rev', 'Para revisar') + '</div></section>';
    if (filtro && !S.admAllUsers) { loadAllUsers(); return h + '<div class="spinner" role="status" aria-label="Cargando"></div><div class="muted small" style="text-align:center">Buscando entre todas las personas…</div>'; }
    if (!U) return h + '<div class="spinner" role="status" aria-label="Cargando"></div>';
    const base = filtro ? S.admAllUsers : U;
    const lista = base.filter(u => {
      const c = cmap[u.id];
      if (uq && !(fold(u.nombre).includes(uq) || String(u.telefono || '').replace(/\D/g, '').includes(uq.replace(/\D/g, '') || '\u0000') || (c && fold(c.placa).replace(/\s/g, '').includes(uq.replace(/\s/g, ''))))) return false;
      if (ut === 'pas') return !c;
      if (ut === 'aprob') return !!c && c.estado === 'aprobado';
      if (ut === 'pend') return !!c && c.estado === 'pendiente';
      if (ut === 'susp') return !!c && c.estado !== 'aprobado' && c.estado !== 'pendiente';
      if (ut === 'rev') return admAlerta(S.admQ[u.id], c);
      return true;
    });
    const vis = filtro ? lista.slice(0, S.admLimit) : lista;
    if (filtro) {
      const faltan = ut === 'rev' ? base.filter(u => !S.admQ[u.id]).length : 0;
      h += '<div class="muted small" aria-live="polite">' + lista.length + (lista.length === 1 ? ' persona encontrada' : ' personas encontradas') + ' de ' + base.length + (faltan ? ' · revisando calidad de ' + faltan + ' más…' : '') + '</div>';
      if (ut === 'rev') admQFill(base); else admQFill(vis);
      if (!lista.length) h += '<div class="card muted" style="text-align:center">Nadie coincide con la búsqueda.</div>';
    }
    h += '<div class="muted small">Calidad de cada persona: calificación recibida como pasajero y como conductor, y tasa de cancelación histórica.</div>';
    vis.forEach(u => {
      const q = S.admQ[u.id], c = cmap[u.id];
      const st = c ? (c.estado === 'aprobado' ? '<span class="pill p-ok">Conductor' + (c.aprobadoSinDocs ? ' · sin documentos' : '') + '</span>' : '<span class="pill p-warn">Conductor ' + esc(c.estado) + '</span>') : '<span class="pill p-info">Pasajero</span>';
      let ql = '<span class="muted small">Calculando calidad…</span>';
      if (q) {
        const pc = q.tot ? Math.round(q.pen * 100 / q.tot) : null;
        ql = '<div class="col" style="gap:2px"><span class="small">' + (q.pN ? '★ ' + fmtRating(q.pAvg) + ' como pasajero (' + q.pN + ')' : 'Sin calificaciones como pasajero') + '</span>' +
          (c ? '<span class="small">' + (q.cN ? '★ ' + fmtRating(q.cAvg) + ' como conductor (' + q.cN + ')' : 'Sin calificaciones como conductor') + '</span>' : '') +
          '<span class="small">' + (pc == null ? 'Sin viajes aceptados' : 'Cancela ' + pc + ' % (' + q.tot + ' viajes)') + '</span></div>';
        if (admAlerta(q, c)) ql += '<span class="pill p-danger" style="align-self:flex-start">Revisar</span>';
      }
      h += '<div class="card" style="gap:8px"><div class="row between" style="align-items:flex-start"><div class="col"><div class="strong">' + esc(u.nombre) + '</div><div class="muted small">' + esc(u.telefono || '') + '</div></div>' + st + '</div>' + ql;
      if (c) h += '<button class="btn btn-ghost btn-sm" style="width:100%" data-act="admDriver" data-v="' + u.id + '">Servicios e ingresos</button>';
      if (!c) {
        if (S.admMake === u.id) {
          h += '<div class="col" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><div class="strong small">Habilitar como conductor</div>' +
            '<div class="field"><label for="am">Marca y modelo del mototour</label><input type="text" id="am" data-in="amMoto" value="' + fv('amMoto') + '"></div>' +
            '<div class="field"><label for="ac">Color</label><input type="text" id="ac" data-in="amColor" value="' + fv('amColor') + '"></div>' +
            '<div class="field"><label for="ap">Placa</label><input type="text" id="ap" data-in="amPlaca" autocapitalize="characters" value="' + fv('amPlaca') + '"></div>' +
            '<div class="field"><label for="ar">Número de registro de tránsito (opcional)</label><input type="text" id="ar" data-in="amReg" autocapitalize="characters" value="' + fv('amReg') + '"></div>' +
            '<div class="field"><label for="ad">Dirección de residencia</label><input type="text" id="ad" data-in="amDir" maxlength="120" value="' + fv('amDir') + '"></div>' +
            '<div class="field"><label for="at">Celular</label><input type="tel" id="at" data-in="amTel" inputmode="numeric" placeholder="10 dígitos" value="' + fv('amTel') + '"></div>' +
            '<label class="check"><input type="checkbox" data-in="amOk"' + (S.f.amOk ? ' checked' : '') + '><span>Confirmo que verifiqué a esta persona y la habilito como conductor sin documentos completos.</span></label>' +
            '<div class="row"><button class="btn btn-gold btn-sm" style="flex:1" data-act="admMakeSave" data-v="' + u.id + '"' + (S.busy || !S.f.amOk ? ' disabled' : '') + '>Habilitar</button><button class="btn btn-ghost btn-sm" style="flex:1" data-act="admMake" data-v="">Cancelar</button></div></div>';
        } else h += '<button class="btn btn-ghost btn-sm" style="width:100%" data-act="admMake" data-v="' + u.id + '">Habilitar como conductor</button>';
      }
      h += '</div>';
    });
    if (filtro ? lista.length > vis.length : U.length >= S.admLimit) h += '<button class="btn btn-ghost" data-act="admMore">Ver más personas</button>';
  }
  if (t === 'mascaras') h += admMascaras();
  if (t === 'mascEdit') h += admMascEdit();
  if (t === 'alertas') {
    const L = A.alertas; if (!L) return h + '<div class="spinner" role="status" aria-label="Cargando"></div>';
    if (!L.length) h += '<div class="card"><div class="strong">Sin alertas activas.</div><div class="muted">Cuando alguien active el botón de pánico, aparece aquí con su ubicación.</div></div>';
    L.forEach(a => { h += '<div class="card" style="border:2px solid #B42318"><div class="row between"><div class="col"><div class="strong">' + esc(a.nombre) + ' (' + esc(a.rol) + ')</div><div class="muted small">' + new Date(tsMs(a.creado)).toLocaleString('es-CO') + '</div></div><span class="pill p-danger">Activa</span></div><div class="row">' + (a.lat != null ? '<a class="btn btn-ghost btn-sm" style="flex:1" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + a.lat + ',' + a.lng + '">Ver ubicación</a>' : '<span class="muted small" style="flex:1">Sin ubicación GPS</span>') + '<button class="btn btn-gold btn-sm" style="flex:1" data-act="admAlert" data-v="' + a.id + '"' + busyAttr() + '>Marcar atendida</button></div></div>'; });
  }
  if (t === 'viajes') h += admViajes();
  if (t === 'suscripciones') h += admSus();
  if (t === 'susFicha') h += admSusFicha();
  if (t === 'tarifas') h += admTarifas();
  if (t === 'ingresos') h += admIngresos();
  if (t === 'notificaciones') h += admNotif();

  return h;
}
/* ---------- panel: búsqueda de viajes, filtros de conductores y notificaciones ---------- */
const MOTIVO_TXT = { ya_no: 'Ya no lo necesitaba', no_llega: 'El conductor no llegaba', inseguro: 'Se sintió inseguro', otro: 'Otro', inconveniente: 'Inconveniente del conductor', no_se_presento: 'El pasajero no se presentó' };
const EST_TXT = { buscando: ['p-info', 'Buscando'], asignado: ['p-info', 'Asignado'], en_punto: ['p-info', 'Conductor en el punto'], en_curso: ['p-warn', 'En curso'], finalizado: ['p-ok', 'Finalizado'], cancelado: ['p-danger', 'Cancelado'] };
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stars = n => n ? '<span style="color:#A8841A;letter-spacing:1px" aria-label="' + n + ' de 5 estrellas">' + '★'.repeat(n) + '<span style="color:var(--star-off)">' + '★'.repeat(5 - n) + '</span></span>' : '';
const mapLink = p => p && p.lat != null ? ' <a class="small" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + p.lat + ',' + p.lng + '">ver mapa</a>' : '';
const fchip = (key, val, label) => '<button class="chip" data-act="admF" data-v="' + key + '=' + val + '" aria-pressed="' + ((S.f[key] || '') === val) + '">' + label + '</button>';
const dateIn = (id, key, label) => '<div class="field"><label for="' + id + '">' + label + '</label><input type="date" id="' + id + '" data-in="' + key + '" value="' + fv(key) + '" style="min-height:48px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:15px;color:var(--ink);background:var(--field);width:100%"></div>';
function calBox(t, c, quien) {
  if (c === undefined) return '<div class="muted small">' + t + ': cargando…</div>';
  if (!c) return '<div class="muted small">' + t + ': ' + quien + ' no calificó.</div>';
  return '<div class="small"><b>' + t + ':</b> ' + stars(c.estrellas) + ' ' + LABELS[c.estrellas] + ((c.aspectos || []).length ? ' · ' + esc(c.aspectos.join(', ')) : '') + (c.comentario ? '<div class="muted" style="margin-top:2px">"' + esc(c.comentario) + '"</div>' : '') + '</div>';
}
function admVFiltrados() {
  const q = fold(S.f.admVQ).trim(), rol = S.f.admVRol || '', est = S.f.admVEst || '', tp = S.f.admVTipo || '';
  return (S.admV || []).filter(v => {
    if (tp === 'envio' && !esEnvio(v)) return false;
    if (tp === 'viaje' && esEnvio(v)) return false;
    if (est === 'finalizado' && v.estado !== 'finalizado') return false;
    if (est === 'cancelado' && v.estado !== 'cancelado') return false;
    if (est === 'activo' && !['buscando', 'asignado', 'en_punto', 'en_curso'].includes(v.estado)) return false;
    if (!q) return true;
    const pax = fold(v.pasajeroNombre), cond = fold(v.conductor ? v.conductor.nombre + ' ' + v.conductor.placa : ''), lug = fold((v.origen ? v.origen.texto : '') + ' ' + (v.destino ? v.destino.texto : ''));
    if (rol === 'pasajero') return pax.includes(q);
    if (rol === 'conductor') return cond.includes(q);
    return pax.includes(q) || cond.includes(q) || lug.includes(q);
  });
}
function admViajes() {
  let h = '<section class="card"><h2 class="h2">Buscar viajes</h2><div class="field"><label for="avq">Nombre del pasajero o del conductor, placa o lugar</label><input type="text" id="avq" data-in="admVQ" data-live="1" placeholder="Ej. Ana, ABC12D, Terminal" value="' + fv('admVQ') + '" autocomplete="off"></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Buscar en</span><div class="chips">' + fchip('admVRol', '', 'Todos') + fchip('admVRol', 'pasajero', 'Pasajero') + fchip('admVRol', 'conductor', 'Conductor') + '</div></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Servicio</span><div class="chips">' + fchip('admVTipo', '', 'Todos') + fchip('admVTipo', 'viaje', 'Viajes') + fchip('admVTipo', 'envio', 'Envíos') + '</div></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Estado</span><div class="chips">' + fchip('admVEst', '', 'Todos') + fchip('admVEst', 'finalizado', 'Finalizados') + fchip('admVEst', 'cancelado', 'Cancelados') + fchip('admVEst', 'activo', 'En curso') + '</div></div>' +
    '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + dateIn('avi', 'admVIni', 'Desde') + dateIn('avf', 'admVFin', 'Hasta') + '</div>' +
    '<button class="btn btn-navy btn-sm" style="min-height:44px" data-act="admVLoad"' + busyAttr() + '>Consultar fechas</button></section>';
  if (S.admV === null) return h + '<div class="spinner" role="status" aria-label="Cargando viajes"></div>';
  const L = admVFiltrados(), fin = L.filter(v => v.estado === 'finalizado');
  const kpi = (label, val, kind) => '<div class="card kpi' + (kind ? ' ' + kind : '') + '"><span class="k">' + label + '</span><span class="v">' + val + '</span></div>';
  h += '<div class="kpis">' + kpi('Viajes encontrados', L.length) + kpi('Finalizados', fin.length) + kpi('Valor pagado', money(fin.reduce((s, v) => s + (v.precioFinal || 0), 0)), 'navy') + kpi('Cancelados', L.filter(v => v.estado === 'cancelado').length) + '</div>';
  if (S.admV.length >= 500) h += '<div class="muted small">Se muestran los 500 viajes más recientes del periodo. Reduce las fechas para ver el resto.</div>';
  if (!L.length) return h + '<div class="card"><div class="muted">No hay viajes con esos filtros.</div></div>';
  const page = L.slice(0, S.admVPage);
  h += '<div class="vgrid">';
  page.forEach(v => {
    const e = EST_TXT[v.estado] || ['p-info', v.estado], cal = S.admCal[v.id] || {};
    h += '<article class="card" style="gap:8px"><div class="row between" style="gap:8px;flex-wrap:wrap"><span class="muted small">' + fmtFecha(tsMs(v.creado)) + '</span><span class="row" style="gap:6px">' + (esEnvio(v) ? TAG_ENV : '') + '<span class="pill ' + e[0] + '">' + e[1] + '</span></span></div>' +
      '<div class="row between" style="align-items:flex-start;gap:10px"><div class="col" style="gap:2px"><span class="small muted">Pasajero</span><button class="link" style="min-height:28px;padding:0" data-act="admVWho" data-v="pasajero|' + esc(v.pasajeroNombre) + '">' + esc(v.pasajeroNombre) + '</button></div>' +
      '<div class="col" style="gap:2px;align-items:flex-end;text-align:right"><span class="small muted">Conductor</span>' + (v.conductor ? '<button class="link" style="min-height:28px;padding:0;text-align:right" data-act="admVWho" data-v="conductor|' + esc(v.conductor.nombre) + '">' + esc(v.conductor.nombre) + '</button><span class="small muted">' + esc(v.conductor.placa || '') + '</span>' : '<span class="small">Sin asignar</span>') + '</div></div>' +
      '<div class="col" style="gap:4px"><div class="row" style="align-items:flex-start"><span class="dot" style="margin-top:5px"></span><div class="small"><b>Recogida:</b> ' + esc(v.origen ? v.origen.texto : '') + mapLink(v.origen) + '</div></div><div class="row" style="align-items:flex-start"><span class="sq" style="margin-top:5px"></span><div class="small"><b>Destino:</b> ' + esc(v.destino ? v.destino.texto : '') + mapLink(v.destino) + '</div></div></div>' +
      (esEnvio(v) ? '<div class="small muted">Contenido: <b>' + contTxt(v.envio && v.envio.contenido) + '</b>' + (v.envio && v.envio.desc ? ' · ' + esc(v.envio.desc) : '') + ' · ' + quienPaga(v) + (v.devolucion ? ' · <b>devuelto</b>' + (v.devolucionMotivo ? ': ' + esc(v.devolucionMotivo) : '') : '') + '</div>' : '') +
      '<div class="row between"><span class="small muted">' + (v.estado === 'finalizado' ? 'Pagó' : 'Ofreció') + ' · ' + pagoTxt(v) + '</span><span class="price" style="font-size:19px">' + money(v.precioFinal || v.oferta) + '</span></div>';
    if (v.estado === 'finalizado') h += '<div class="col" style="gap:6px;border-top:1px solid var(--line);padding-top:8px">' + calBox('Pasajero calificó al conductor', cal.pc, 'El pasajero') + calBox('Conductor calificó al pasajero', cal.cp, 'El conductor') + '</div>';
    if (v.estado === 'cancelado') h += '<div class="muted small">Motivo: ' + esc(MOTIVO_TXT[v.motivo] || v.motivo || 'sin motivo') + (v.motivoTexto ? ': ' + esc(v.motivoTexto) : '') + (v.canceladoPor ? ' · canceló el ' + (v.canceladoPor === v.pasajeroId ? 'pasajero' : 'conductor') : '') + (v.penalizaA ? ' · penaliza al ' + esc(v.penalizaA) : '') + '</div>';
    h += '</article>';
  });
  h += '</div>';
  if (L.length > S.admVPage) h += '<button class="btn btn-ghost" data-act="admVMore">Ver más viajes (' + (L.length - S.admVPage) + ' más)</button>';
  loadAdmCal(page);
  return h;
}
let calBusy = false;
async function loadAdmCal(list) {
  const falta = list.filter(v => v.estado === 'finalizado' && !S.admCal[v.id]); if (!falta.length || calBusy) return;
  calBusy = true;
  await Promise.all(falta.map(async v => {
    S.admCal[v.id] = {};
    const [a, b] = await Promise.all([v.conductorId ? getDoc(doc(db, 'conductores', v.conductorId, 'calificaciones', v.id)).catch(() => null) : null, getDoc(doc(db, 'usuarios', v.pasajeroId, 'calificaciones', v.id)).catch(() => null)]);
    S.admCal[v.id] = { pc: a && a.exists() ? a.data() : null, cp: b && b.exists() ? b.data() : null };
  }));
  calBusy = false;
  if (S.screen === 'admin' && S.admTab === 'viajes') render();
}
async function loadAdmViajes() {
  const hoy = new Date();
  if (!S.f.admVIni) S.f.admVIni = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (!S.f.admVFin) S.f.admVFin = ymd(hoy);
  const ini = fromYmd(S.f.admVIni), fin = fromYmd(S.f.admVFin, true);
  if (!ini || !fin || fin < ini) { S.err = 'Revisa las fechas: la fecha final no puede ser anterior a la inicial.'; S.admV = S.admV || []; render(); return; }
  S.admV = null; S.admVPage = 20; render();
  try {
    const qs = await getDocs(query(collection(db, 'viajes'), where('creado', '>=', ini), where('creado', '<=', fin), orderBy('creado', 'desc'), limit(500)));
    S.admV = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (e) { S.admV = []; S.err = errMsg(e); }
  if (S.screen === 'admin') render();
}
// Conductores
function admDrvFiltrados(L) {
  const q = fold(S.f.admCQ).trim(), est = S.f.admCEst || '', cal = S.f.admCCal || '', ord = S.f.admCOrd || '';
  const R = id => S.admRate[id];
  let out = L.filter(c => {
    if (est && c.estado !== est) return false;
    if (q && !fold(c.nombre + ' ' + c.placa + ' ' + (c.registro || '') + ' ' + c.moto).includes(q)) return false;
    const r = R(c.id);
    if (cal === 'bajo45' && !(r && r.n && r.avg < 4.5)) return false;
    if (cal === 'bajo42' && !(r && r.n && r.avg < 4.2)) return false;
    if (cal === 'sin' && !(r && !r.n)) return false;
    return true;
  });
  const avg = c => { const r = R(c.id); return r && r.n ? r.avg : null; };
  if (ord === 'peor') out.sort((a, b) => (avg(a) == null ? 9 : avg(a)) - (avg(b) == null ? 9 : avg(b)));
  else if (ord === 'mejor') out.sort((a, b) => (avg(b) == null ? -1 : avg(b)) - (avg(a) == null ? -1 : avg(a)));
  else if (ord === 'nombre') out.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  else out.sort((a, b) => (a.estado === 'pendiente' ? 0 : 1) - (b.estado === 'pendiente' ? 0 : 1));
  return out;
}
function admDrvFiltros(total, n) {
  return '<section class="card"><div class="field"><label for="acq">Buscar conductor (nombre, placa o registro)</label><input type="text" id="acq" data-in="admCQ" data-live="1" placeholder="Ej. Carlos o ABC12D" value="' + fv('admCQ') + '" autocomplete="off"></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Estado</span><div class="chips">' + fchip('admCEst', '', 'Todos') + fchip('admCEst', 'pendiente', 'Pendientes') + fchip('admCEst', 'aprobado', 'Aprobados') + fchip('admCEst', 'suspendido', 'Suspendidos') + fchip('admCEst', 'rechazado', 'Rechazados') + '</div></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Calificación</span><div class="chips">' + fchip('admCCal', '', 'Todas') + fchip('admCCal', 'bajo45', 'Menos de 4,5') + fchip('admCCal', 'bajo42', 'Menos de 4,2') + fchip('admCCal', 'sin', 'Sin calificaciones') + '</div></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Ordenar</span><div class="chips">' + fchip('admCOrd', '', 'Pendientes primero') + fchip('admCOrd', 'peor', 'Peor calificación') + fchip('admCOrd', 'mejor', 'Mejor calificación') + fchip('admCOrd', 'nombre', 'Nombre') + '</div></div>' +
    '<div class="muted small">' + n + ' de ' + total + ' conductores</div></section>';
}
function admDrvRating(c) {
  const r = S.admRate[c.id];
  let h = '<div class="row between" style="gap:8px;flex-wrap:wrap"><span class="small">' + (!r ? 'Calificación: calculando…' : !r.n ? 'Sin calificaciones aún' : '<b>★ ' + fmtRating(r.avg) + '</b> promedio · ' + r.n + (r.n === 1 ? ' calificación' : ' calificaciones')) + (r && r.n >= 5 && r.avg < 4.2 ? ' <span class="pill p-danger">Revisar</span>' : r && r.n >= 5 && r.avg < 4.5 ? ' <span class="pill p-warn">Bajo 4,5</span>' : '') + '</span>' +
    (r && r.n ? '<button class="link" style="font-size:13px;min-height:36px" data-act="admRates" data-v="' + c.id + '" aria-expanded="' + (S.admRateOpen === c.id) + '">' + (S.admRateOpen === c.id ? 'Ocultar calificaciones' : 'Ver calificaciones') + '</button>' : '') + '</div>';
  if (S.admRateOpen === c.id) {
    const L = S.admRateList[c.id];
    if (!L) h += '<div class="spinner" role="status" aria-label="Cargando calificaciones"></div>';
    else h += '<div class="col" style="gap:6px;background:var(--field);border-radius:12px;padding:10px">' + L.map(x => '<div class="col" style="gap:2px;padding:6px 0;border-bottom:1px solid var(--line)"><div class="row between small"><span>' + stars(x.estrellas) + ' ' + LABELS[x.estrellas] + '</span><span class="muted">' + fmtFecha(tsMs(x.creado)) + '</span></div>' + ((x.aspectos || []).length ? '<div class="small muted">' + esc(x.aspectos.join(', ')) + '</div>' : '') + (x.comentario ? '<div class="small">"' + esc(x.comentario) + '"</div>' : '') + '</div>').join('') + '<div class="muted small">Últimas ' + L.length + ' calificaciones.</div></div>';
  }
  return h;
}
let rateBusy = false;
async function loadAdmRates() {
  const L = S.adm.conductores || [], falta = L.filter(c => !S.admRate[c.id]); if (!falta.length || rateBusy) return;
  rateBusy = true;
  for (let i = 0; i < falta.length; i += 10) {
    await Promise.all(falta.slice(i, i + 10).map(async c => {
      try { const a = await getAggregateFromServer(collection(db, 'conductores', c.id, 'calificaciones'), { n: count(), avg: average('estrellas') }); const d = a.data(); S.admRate[c.id] = { n: d.n || 0, avg: d.avg || 0 }; } catch (e) { S.admRate[c.id] = { n: 0, avg: 0 }; }
    }));
    if (S.screen === 'admin' && S.admTab === 'conductores') render();
  }
  rateBusy = false;
}
// Notificaciones (servidor de avisos)
function admNotif() {
  const P = S.admPush;
  let h = '<section class="card"><h2 class="h2">Servidor de avisos</h2><div class="muted small">Dirección del servidor de Cloudflare que envía las notificaciones (termina en .workers.dev).</div>' +
    '<div class="field"><label for="apu">Dirección del servidor</label><input type="text" id="apu" data-in="admPushUrl" placeholder="https://jnf-moto-avisos.tu-cuenta.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + fv('admPushUrl') + '"></div>' +
    '<div class="row" style="flex-wrap:wrap"><button class="btn btn-gold btn-sm" style="flex:1;min-height:44px" data-act="admPushSave"' + busyAttr() + '>Guardar</button><button class="btn btn-ghost btn-sm" style="flex:1;min-height:44px" data-act="admPushCheck"' + busyAttr() + '>Probar servidor</button><button class="btn btn-ghost btn-sm" style="flex:1;min-height:44px" data-act="pushTest"' + busyAttr() + '>Enviarme una prueba</button></div>' +
    (S.admPushRes ? '<div class="small" role="status">' + esc(S.admPushRes) + '</div>' : '') + '</section>';
  h += '<section class="card"><h2 class="h2">Celulares con notificaciones</h2>' + (!P ? '<div class="spinner" role="status" aria-label="Cargando"></div>' : '<div class="kpis">' +
    '<div class="card kpi navy"><span class="k">Conductores en línea con aviso</span><span class="v">' + P.online + '</span></div><div class="card kpi"><span class="k">Celulares registrados</span><span class="v">' + P.total + '</span></div></div>') +
    '<div class="muted small">Un conductor recibe solicitudes con la app cerrada solo si activó las notificaciones y dejó el botón "En línea" encendido.</div></section>';
  return h;
}
async function loadAdmPush() {
  S.f.admPushUrl = S.f.admPushUrl != null ? S.f.admPushUrl : S.pushUrl;
  try { const [a, b] = await Promise.all([getCountFromServer(query(collection(db, 'push'), where('online', '==', true))), getCountFromServer(collection(db, 'push'))]); S.admPush = { online: a.data().count, total: b.data().count }; } catch (e) { S.admPush = { online: 0, total: 0 }; }
  if (S.screen === 'admin' && S.admTab === 'notificaciones') render();
}
function vTerminos() {
  const sec = (t, b) => '<div class="col" style="gap:6px"><div class="h2">' + t + '</div>' + b + '</div>';
  const p = t => '<div class="small" style="line-height:1.55">' + t + '</div>';
  return '<div class="screen">' + subTop('Términos y condiciones', S.perfil ? 'menu' : 'login') + '<div class="pad"><div class="card" style="gap:14px">' +
    sec('1. Titular', p('Motocaimán es una aplicación de Asesorías y Consultorías JNF S.A.S., NIT 901.904.435-9, con oficina en la Cra. 13 N° 10-01, Of. 1. Contacto: 310 657 1274 · 311 302 8402.')) +
    sec('2. Qué es Motocaimán', p('Es una plataforma tecnológica que permite a pasajeros y conductores de mototour ponerse en contacto para viajes y para envíos de documentos y paquetes. El valor de cada servicio lo acuerdan libremente el usuario y el conductor dentro de la aplicación; la tarifa mínima es la que indica la app.')) +
    sec('3. Uso de la aplicación', p('Quien usa Motocaimán se compromete a dar información verdadera, a tratar con respeto a los demás usuarios y a no usar la aplicación con fines ilegales o fraudulentos. Las cuentas pueden ser suspendidas por incumplir estas condiciones, por calificaciones bajas reiteradas o por cancelaciones frecuentes, según las reglas que muestra la app.')) +
    sec('4. Conductores', p('Para conducir se requiere estar aprobado por el administrador y registrar su documento de identidad (cédula de ciudadanía, cédula de extranjería, PPT o pasaporte) y mantener vigentes la licencia de conducción, el SOAT, la tarjeta de propiedad y el registro ante la Secretaría de Tránsito. El uso del modo conductor tiene una suscripción: el primer mes es gratis desde la fecha de inscripción y luego se paga según el plan y las tarifas vigentes publicadas en "Mi suscripción". Si el pago se vence y terminan los días de gracia, el modo conductor queda bloqueado hasta que se registre el pago.')) +
    sec('5. Envíos', p('Quien solicita un envío declara que su contenido no incluye dinero en efectivo, armas, sustancias prohibidas, animales vivos ni objetos ilegales, y responde por esa declaración. El conductor puede negarse a llevar un envío si duda de su contenido. Asesorías y Consultorías JNF S.A.S. actúa solo como intermediario tecnológico: no recibe, custodia ni transporta los envíos. La entrega se confirma con el código de 4 dígitos que la app le da a quien envía; si no es posible entregar, el conductor devuelve el envío a quien lo envió, y en ese caso el valor lo paga quien envía.')) +
    sec('6. Seguridad', p('La app ofrece botón de pánico y contactos de emergencia. En una emergencia comunícate también con la línea 123.')) +
    sec('7. Propiedad intelectual', p('El nombre Motocaimán, el logo de JNF S.A.S., el diseño, los textos y el código de la aplicación son propiedad de Asesorías y Consultorías JNF S.A.S. Todos los derechos reservados. Se prohíbe su reproducción, copia, modificación o distribución, total o parcial, sin autorización escrita del titular.')) +
    sec('8. Tratamiento de datos personales', p('Asesorías y Consultorías JNF S.A.S. trata tus datos (nombre, celular, correo, ubicación durante los viajes; en los envíos, el nombre y el celular de quien recibe; y, para conductores, número y copia del documento de identidad, demás documentos, dirección y datos del vehículo) conforme a la Ley 1581 de 2012 y sus decretos reglamentarios, únicamente para prestar el servicio de la app, garantizar la seguridad de los viajes y llevar el control de las suscripciones. Como titular puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización, escribiendo a los contactos del numeral 1.')) +
    sec('9. Cambios', p('Estos términos pueden actualizarse; la versión vigente es la publicada en la aplicación.')) +
    '<div class="muted small">' + COPY() + '</div></div></div></div>';
}
/* ---------- suscripciones, pagos, referidos e ingresos ---------- */
// suscripciones/{conductor}: plan, inicio (inscripción), pagadoHasta (fecha del próximo pago), venceGracia (fin de la gracia),
// nPagos, referidoPor, refPend (referidos cuyo descuento falta aplicar). pagos/{id}: recibos JNF-0001… config/tarifas: valores y reglas.
const TARIFAS0 = { semanal: 12000, quincenal: 22000, mensual: 40000, diasGratis: 30, diasGracia: 3, refTipo: 'fijo', refValor: 10000, instrucciones: 'Paga por Nequi o Daviplata al número que te indique JNF S.A.S., o en efectivo en la oficina: Cra. 13 N° 10-01, Of. 1. El administrador registra tu pago.' };
const PLANES = [['semanal', 'Semanal'], ['quincenal', 'Quincenal'], ['mensual', 'Mensual']];
const MEDIOS = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia'];
const planTxt = p => (PLANES.find(x => x[0] === p) || [0, p])[1];
const tarifas = () => Object.assign({}, TARIFAS0, S.tarifas || {});
function addDays(s, n) { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function addMonth(s) { const d = fromYmd(s), day = d.getDate(), t = new Date(d.getFullYear(), d.getMonth() + 1, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(day, last)); return ymd(t); }
const diffDays = (a, b) => Math.round((fromYmd(b) - fromYmd(a)) / 86400000);
const finPeriodo = (desde, plan) => plan === 'semanal' ? addDays(desde, 7) : plan === 'quincenal' ? addDays(desde, 15) : addMonth(desde);
const venceGraciaDe = (pagadoHasta, T) => fromYmd(addDays(pagadoHasta, T.diasGracia || 0), true);
const codigoDe = c => c && c.placa ? 'JNF-' + c.placa : '';
const round100 = n => Math.round(n / 100) * 100;
function susEstado(s) {
  if (!s || !s.pagadoHasta) return null;
  const hoy = ymd(new Date()), T = tarifas();
  if (hoy <= s.pagadoHasta) { const dias = diffDays(hoy, s.pagadoHasta); return { k: dias <= 3 ? 'porvencer' : (s.nPagos ? 'aldia' : 'gratis'), dias }; }
  const lim = addDays(s.pagadoHasta, T.diasGracia || 0);
  return hoy <= lim ? { k: 'gracia', hasta: lim } : { k: 'mora', hasta: lim };
}
const EST_SUS = { gratis: ['p-free', 'Mes gratis'], aldia: ['p-ok', 'Al día'], porvencer: ['p-warn', 'Por vencer'], gracia: ['p-danger', 'En mora'], mora: ['p-danger', 'Bloqueado'] };
const susPill = e => e ? '<span class="pill ' + EST_SUS[e.k][0] + '">' + EST_SUS[e.k][1] + '</span>' : '<span class="pill p-info">Sin suscripción</span>';
function descRef(s, valor) { const T = tarifas(), n = (s.refPend || []).length; if (!n) return 0; const u = T.refTipo === 'pct' ? round100(valor * T.refValor / 100) : T.refValor; return Math.min(valor, n * u); }
const conductorBloqueado = () => { const e = susEstado(S.sus); return !!(e && e.k === 'mora'); };
// Conductor: aviso o bloqueo en Solicitudes
function susAviso() {
  const e = susEstado(S.sus); if (!e) return '';
  const T = tarifas(), val = T[S.sus.plan] || 0;
  if (e.k === 'gracia') return '<div class="banner warn">' + I.info + '<div class="grow"><b>Tu pago venció el ' + fmtYmd(S.sus.pagadoHasta) + '.</b> Tienes hasta el ' + fmtYmd(e.hasta) + ' para pagar ' + money(val) + '; después no podrás conectarte.</div><button data-act="go" data-v="suscripcion">Ver</button></div>';
  if (e.k === 'mora') return '<div class="card" style="border:2px solid #B42318;gap:10px"><div class="h2" style="color:var(--danger-text)">No puedes conectarte</div><div>Tu suscripción ' + planTxt(S.sus.plan).toLowerCase() + ' venció el ' + fmtYmd(S.sus.pagadoHasta) + ' y terminaron los ' + T.diasGracia + ' días de gracia.</div><div class="row between"><span class="muted">Valor pendiente</span><span class="strong">' + money(val) + '</span></div><div class="muted small">' + esc(T.instrucciones) + ' Cuando el administrador registre tu pago, podrás conectarte de nuevo.</div><button class="btn btn-ghost" data-act="go" data-v="suscripcion">Ver mi suscripción</button><div class="muted small center">Puedes seguir usando la app como pasajero.</div></div>';
  if (e.k === 'porvencer') return '<div class="banner info">' + I.info + '<div class="grow">' + (S.sus.nPagos ? 'Tu próximo pago' : 'Tu mes gratis termina y el primer pago') + ' es el ' + fmtYmd(S.sus.pagadoHasta) + ' (' + money(val) + ').</div><button data-act="go" data-v="suscripcion">Ver</button></div>';
  return '';
}
function vMiSus() {
  const T = tarifas(), c = S.conductor || {}, s = S.sus, e = susEstado(s), cod = codigoDe(c);
  let h = '<div class="screen">' + subTop('Mi suscripción') + '<div class="pad">' + errHTML() + bannerHTML(S.banner);
  const ins = s ? s.inicio : (c.creado ? ymd(new Date(tsMs(c.creado))) : null);
  const gratisHasta = ins ? addDays(ins, T.diasGratis) : null;
  h += '<div class="card" style="gap:8px"><div class="row between"><div class="h2">Plan ' + planTxt(s ? s.plan : 'mensual').toLowerCase() + '</div>' + (e ? susPill(e) : '<span class="pill p-free">Mes gratis</span>') + '</div>' +
    (ins ? '<div class="row between"><span class="muted">Inscrito el</span><span class="strong">' + fmtYmd(ins) + '</span></div><div class="row between"><span class="muted">Mes gratis</span><span class="strong">' + fmtYmd(ins).slice(0, 5) + ' al ' + fmtYmd(gratisHasta).slice(0, 5) + '</span></div>' : '') +
    (s ? '<div class="row between"><span class="muted">Próximo pago</span><span class="strong">' + fmtYmd(s.pagadoHasta) + '</span></div><div class="row between"><span class="muted">Valor</span><span class="strong">' + money(T[s.plan] || 0) + '</span></div>' : '<div class="muted small">El administrador activa tu plan al terminar el mes gratis.</div>') +
    (s && (s.refPend || []).length ? '<div class="banner ok">' + I.info + '<div class="grow">Tienes ' + money(descRef(s, T[s.plan] || 0)) + ' de descuento por referidos en tu próximo pago.</div></div>' : '') + '</div>';
  if (cod) {
    const R = S.misRef;
    h += '<div class="card" style="gap:10px"><div class="h2">Gana descuentos refiriendo conductores</div><div class="muted small">Por cada conductor que se inscriba con tu código y haga su primer pago, te descontamos ' + (T.refTipo === 'pct' ? T.refValor + ' %' : money(T.refValor)) + ' en tu siguiente pago.</div>' +
      '<div class="row between" style="background:var(--field);border:1px dashed var(--gold);border-radius:12px;padding:10px 12px"><span style="font-size:20px;font-weight:800;letter-spacing:1px">' + esc(cod) + '</span><button class="btn btn-gold btn-sm" data-act="shareRef">Compartir</button></div>' +
      '<div class="small">' + (!R ? 'Cargando referidos…' : !R.length ? 'Aún no tienes referidos.' : '<b>Referidos:</b> ' + R.map(r => esc(r.nombre) + (r.ok ? ' (descuento ganado)' : ' (pendiente de su primer pago)')).join(', ')) + '</div></div>';
  }
  const P = S.misPagos;
  h += '<div class="card" style="gap:8px"><div class="h2">Mis pagos</div>' + (!P ? '<div class="spinner" role="status" aria-label="Cargando"></div>' : !P.length ? '<div class="muted small">Aún no tienes pagos registrados.</div>' :
    P.map(p => '<div class="row between small"><span>' + fmtYmd(p.fecha).slice(0, 5) + ' · ' + esc(p.medio) + ' · recibo ' + esc(p.recibo) + '</span><span class="strong">' + money(p.neto) + '</span></div>').join('')) + '</div>';
  h += '<div class="card" style="gap:6px"><div class="h2">¿Cómo pago?</div><div class="muted small">' + esc(T.instrucciones) + '</div></div>';
  return h + '</div></div>';
}
async function loadMiSus() {
  const uid = S.user.uid;
  try { const qs = await getDocs(query(collection(db, 'pagos'), where('cid', '==', uid), limit(100))); S.misPagos = qs.docs.map(d => d.data()).filter(p => !p.anulado).sort((a, b) => b.fecha.localeCompare(a.fecha)); } catch (e) { S.misPagos = []; }
  if (S.screen === 'suscripcion') render();
  const cod = codigoDe(S.conductor);
  if (cod) { try { const qs = await getDocs(query(collection(db, 'conductores'), where('refCodigo', '==', cod), limit(50))); const pend = (S.sus && S.sus.refPend) || [], apl = (S.sus && S.sus.refAplic) || []; S.misRef = qs.docs.map(d => ({ nombre: d.data().nombre, ok: pend.includes(d.id) || apl.includes(d.id) })); } catch (e) { S.misRef = []; } }
  if (S.screen === 'suscripcion') render();
}
// Administrador
async function loadTarifas() { try { const d = await getDoc(doc(db, 'config', 'tarifas')); S.tarifas = d.exists() ? d.data() : null; } catch (e) { } }
async function loadSus() {
  await loadTarifas();
  const T = tarifas();
  try {
    const qs = await getDocs(query(collection(db, 'suscripciones'), limit(500)));
    const m = {}; qs.docs.forEach(d => { m[d.id] = Object.assign({ id: d.id }, d.data()); });
    // Crea la suscripción de los conductores aprobados que aún no la tienen (mes gratis desde su inscripción)
    const falta = (S.adm.conductores || []).filter(c => c.estado === 'aprobado' && !m[c.id]);
    if (falta.length) {
      const porPlaca = {}; (S.adm.conductores || []).forEach(c => { porPlaca['JNF-' + c.placa] = c.id; });
      const bt = writeBatch(db);
      falta.forEach(c => {
        const inicio = ymd(new Date(tsMs(c.creado))), ph = addDays(inicio, T.diasGratis), ref = c.refCodigo && porPlaca[c.refCodigo] && porPlaca[c.refCodigo] !== c.id ? porPlaca[c.refCodigo] : null;
        const d = { plan: 'mensual', inicio, pagadoHasta: ph, venceGracia: venceGraciaDe(ph, T), nPagos: 0, referidoPor: ref, refPend: [], refAplic: [], refAcreditado: false, nombre: c.nombre, placa: c.placa };
        bt.set(doc(db, 'suscripciones', c.id), d); m[c.id] = Object.assign({ id: c.id }, d);
      });
      await bt.commit();
    }
    S.susMap = m;
  } catch (e) { S.susMap = S.susMap || {}; S.err = errMsg(e); }
  if (S.screen === 'admin') render();
}
function susFila(s) { const c = (S.adm.conductores || []).find(x => x.id === s.id) || {}; return { s, c, e: susEstado(s), val: tarifas()[s.plan] || 0 }; }
function admSus() {
  if (!S.susMap) return '<div class="spinner" role="status" aria-label="Cargando"></div>';
  const T = tarifas(), filas = Object.values(S.susMap).map(susFila), q = fold(S.f.susQ).trim(), fe = S.f.susEst || '';
  const n = k => filas.filter(f => f.e && (Array.isArray(k) ? k.includes(f.e.k) : f.e.k === k)).length;
  const ingMes = (S.pagosMes || []).reduce((a, p) => a + (p.neto || 0), 0);
  let h = '<div class="kpis kpis5">' + ['Ingresos del mes|' + (S.pagosMes ? money(ingMes) : '…') + '|navy', 'Al día|' + n('aldia') + '|', 'En mes gratis|' + n('gratis') + '|', 'Por vencer (3 días)|' + n('porvencer') + '|', 'En mora|' + n(['gracia', 'mora']) + '|alert'].map(x => { const [k, v, c] = x.split('|'); return '<div class="card kpi' + (c ? ' ' + c : '') + '"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }).join('') + '</div>';
  h += '<section class="card"><div class="field"><label for="sq">Buscar conductor</label><input type="text" id="sq" data-in="susQ" data-live="1" placeholder="Nombre o placa" value="' + fv('susQ') + '" autocomplete="off"></div><div class="chips">' +
    fchip('susEst', '', 'Todos (' + filas.length + ')') + fchip('susEst', 'gratis', 'Mes gratis (' + n('gratis') + ')') + fchip('susEst', 'aldia', 'Al día (' + n('aldia') + ')') + fchip('susEst', 'porvencer', 'Por vencer (' + n('porvencer') + ')') + fchip('susEst', 'mora', 'En mora (' + n(['gracia', 'mora']) + ')') + '</div>' +
    '<div class="row" style="flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-act="admTab" data-v="tarifas">Tarifas y referidos</button><span class="muted small">Semanal ' + money(T.semanal) + ' · Quincenal ' + money(T.quincenal) + ' · Mensual ' + money(T.mensual) + ' · ' + T.diasGratis + ' días gratis · ' + T.diasGracia + ' días de gracia</span></div></section>';
  const ord = { mora: 0, gracia: 1, porvencer: 2, gratis: 3, aldia: 4 };
  const L = filas.filter(f => (!q || fold(f.s.nombre + ' ' + f.s.placa).includes(q)) && (!fe || (f.e && (fe === 'mora' ? ['gracia', 'mora'].includes(f.e.k) : f.e.k === fe))))
    .sort((a, b) => ((a.e ? ord[a.e.k] : 9) - (b.e ? ord[b.e.k] : 9)) || String(a.s.pagadoHasta).localeCompare(String(b.s.pagadoHasta)));
  if (!L.length) return h + '<div class="card"><div class="muted">' + (filas.length ? 'No hay conductores con esos filtros.' : 'Aún no hay conductores aprobados.') + '</div></div>';
  const prox = f => f.e && f.e.k === 'gratis' ? '<b>Gratis hasta ' + fmtYmd(f.s.pagadoHasta).slice(0, 5) + '</b>' : f.e && (f.e.k === 'gracia' || f.e.k === 'mora') ? '<b>Venció ' + fmtYmd(f.s.pagadoHasta).slice(0, 5) + '</b><br><span class="small" style="color:var(--danger-text)">' + (f.e.k === 'gracia' ? 'Gracia hasta ' + fmtYmd(f.e.hasta).slice(0, 5) : 'Sin poder conectarse') + '</span>' : fmtYmd(f.s.pagadoHasta) + (f.e && f.e.k === 'porvencer' ? '<br><span class="small muted">en ' + f.e.dias + ' día' + (f.e.dias === 1 ? '' : 's') + '</span>' : '');
  const accion = f => '<button class="btn ' + (f.e && ['gracia', 'mora', 'porvencer'].includes(f.e.k) ? 'btn-gold' : 'btn-ghost') + ' btn-sm" data-act="susFicha" data-v="' + f.s.id + '">' + (f.e && f.e.k !== 'gratis' && f.e.k !== 'aldia' ? 'Registrar pago' : 'Ver') + '</button>';
  const valTxt = f => { const d = descRef(f.s, f.val); return money(f.val - d) + (d ? '<br><span class="small" style="color:var(--ok-ink)">−' + money(d) + ' referido</span>' : ''); };
  if (isWide()) {
    h += '<section class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th scope="col">Conductor</th><th scope="col">Inscrito</th><th scope="col">Plan</th><th scope="col">Próximo pago</th><th scope="col">Valor</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead><tbody>' +
      L.map(f => '<tr' + (f.e && (f.e.k === 'gracia' || f.e.k === 'mora') ? ' style="background:var(--danger-bg)"' : '') + '><td><span class="strong">' + esc(f.s.nombre) + '</span><br><span class="small muted">Placa ' + esc(f.s.placa) + '</span></td><td>' + fmtYmd(f.s.inicio) + '</td><td>' + planTxt(f.s.plan) + '</td><td>' + prox(f) + '</td><td>' + valTxt(f) + '</td><td>' + susPill(f.e) + '</td><td>' + accion(f) + '</td></tr>').join('') + '</tbody></table></section>';
  } else L.forEach(f => { h += '<div class="card" style="gap:6px' + (f.e && (f.e.k === 'gracia' || f.e.k === 'mora') ? ';border:2px solid #B42318' : '') + '"><div class="row between"><div class="col"><span class="strong">' + esc(f.s.nombre) + '</span><span class="small muted">Placa ' + esc(f.s.placa) + ' · inscrito ' + fmtYmd(f.s.inicio) + '</span></div>' + susPill(f.e) + '</div><div class="row between small"><span>' + planTxt(f.s.plan) + ' · ' + valTxt(f) + '</span><span style="text-align:right">' + prox(f) + '</span></div>' + accion(f) + '</div>'; });
  return h;
}
function admSusFicha() {
  const s = S.susMap && S.susMap[S.susId]; let h = '<button class="link" data-act="admTab" data-v="suscripciones" style="align-self:flex-start">← Volver a suscripciones</button>';
  if (!s) return h + '<div class="card"><div class="muted">No se encontró la suscripción.</div></div>';
  const T = tarifas(), c = (S.adm.conductores || []).find(x => x.id === s.id) || {}, e = susEstado(s), val = T[s.plan] || 0, dr = descRef(s, val);
  const refDe = s.referidoPor ? (S.susMap[s.referidoPor] || (S.adm.conductores || []).find(x => x.id === s.referidoPor) || {}).nombre || 'Conductor' : null;
  const suyos = (S.adm.conductores || []).filter(x => (S.susMap[x.id] && S.susMap[x.id].referidoPor === s.id) || (x.refCodigo && x.refCodigo === codigoDe(c) && x.id !== s.id));
  const pv = S.admPriv[s.id];
  let izq = '<section class="card"><div class="row between" style="flex-wrap:wrap;gap:8px"><div class="col"><h2 class="h2">' + esc(s.nombre) + '</h2><span class="small muted">' + esc(c.moto || '') + ' ' + esc(c.color || '') + ' · Placa ' + esc(s.placa) + (pv && pv.telefono ? ' · Cel. ' + esc(pv.telefono) : '') + ' · Código ' + esc(codigoDe(c)) + '</span></div>' + susPill(e) + '</div>' +
    '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div style="background:#EDE6FA;color:#4B2A8A;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:2px"><span class="small strong">Inscrito el</span><span style="font-size:18px;font-weight:800">' + fmtYmd(s.inicio) + '</span><span class="small">Mes gratis: ' + fmtYmd(s.inicio).slice(0, 5) + ' al ' + fmtYmd(addDays(s.inicio, T.diasGratis)).slice(0, 5) + '</span></div>' +
    '<div style="background:var(--warn-bg);color:var(--warn-ink);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:2px"><span class="small strong">Próximo pago</span><span style="font-size:18px;font-weight:800">' + fmtYmd(s.pagadoHasta) + '</span><span class="small">Plan ' + planTxt(s.plan).toLowerCase() + ' · ' + money(val) + '</span></div></div>' +
    '<div class="col" style="gap:6px"><span class="lbl">Plan</span><div class="chips">' + PLANES.map(p => '<button class="chip" data-act="susPlan" data-v="' + p[0] + '" aria-pressed="' + (s.plan === p[0]) + '"' + busyAttr() + '>' + p[1] + ' · ' + money(T[p[0]]) + '</button>').join('') + '</div></div>';
  if (!s.nPagos) izq += '<div class="col" style="gap:6px"><span class="lbl">Fecha de inscripción (inicio del mes gratis)</span><div class="row"><input type="date" data-in="susIni" value="' + fv('susIni') + '" aria-label="Fecha de inscripción" style="min-height:44px;border:1px solid var(--line);border-radius:12px;padding:8px 12px;font:inherit;color:var(--ink);background:var(--field);flex:1"><button class="btn btn-ghost btn-sm" data-act="susIniSave"' + busyAttr() + '>Cambiar</button></div><span class="small muted">Solo se puede cambiar antes del primer pago.</span></div>';
  izq += '<div class="col" style="gap:6px"><span class="lbl">Referido por</span><div class="row"><input type="text" data-in="susRefCod" placeholder="Código del conductor que lo refirió (JNF-placa)" value="' + fv('susRefCod') + '" aria-label="Código de quien lo refirió" autocapitalize="characters" style="min-height:44px;border:1px solid var(--line);border-radius:12px;padding:8px 12px;font:inherit;color:var(--ink);background:var(--field);flex:1;min-width:0"><button class="btn btn-ghost btn-sm" data-act="susRefSave"' + busyAttr() + '>Guardar</button></div><span class="small">' + (refDe ? 'Referido por <b>' + esc(refDe) + '</b>' + (s.refAcreditado ? ' · descuento ya acreditado' : ' · se acredita en su primer pago') : 'Sin referido') + '</span></div>';
  izq += '<div class="col" style="gap:6px"><span class="lbl">Conductores que refirió</span>' + (suyos.length ? suyos.map(x => { const sx = S.susMap[x.id] || {}, st = (s.refAplic || []).includes(x.id) ? ['p-ok', 'Descuento aplicado'] : (s.refPend || []).includes(x.id) ? ['p-warn', 'Descuento por aplicar'] : ['p-info', 'Descuento cuando pague']; return '<div class="row between small" style="background:var(--field);border-radius:10px;padding:8px 10px"><span>' + esc(x.nombre) + (sx.inicio ? ' · inscrito ' + fmtYmd(sx.inicio).slice(0, 5) : '') + '</span><span class="pill ' + st[0] + '">' + st[1] + '</span></div>'; }).join('') : '<span class="small muted">Ninguno aún.</span>') + '</div></section>';
  const P = S.susPagos, ultimoPago = P ? P.find(x => !x.anulado) : null;
  izq += '<section class="card"><h2 class="h2">Historial de pagos</h2>' + (!P ? '<div class="spinner" role="status" aria-label="Cargando"></div>' : !P.length ? '<div class="muted small">Sin pagos registrados.</div>' :
    '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th scope="col">Recibo</th><th scope="col">Fecha</th><th scope="col">Periodo cubierto</th><th scope="col">Pagó</th><th scope="col">Medio</th></tr></thead><tbody>' +
    P.map(p => { const ult = ultimoPago === p, an = p.anulado; return '<tr' + (an ? ' style="opacity:.6"' : '') + '><td>' + esc(p.recibo) + (an ? '<br><span class="pill p-danger">Anulado</span>' : '') + '</td><td>' + fmtYmd(p.fecha) + '</td><td>' + fmtYmd(p.desde).slice(0, 5) + ' al ' + fmtYmd(p.hasta).slice(0, 5) + '</td><td class="strong"' + (an ? ' style="text-decoration:line-through"' : '') + '>' + money(p.neto) + ((p.descRef || p.descOtro) ? '<br><span class="small muted">desc. ' + money((p.descRef || 0) + (p.descOtro || 0)) + '</span>' : '') + '</td><td>' + esc(p.medio) + (ult ? '<br><button class="link danger" style="font-size:12px;min-height:30px;padding:0" data-act="pagAnularAsk" data-v="' + p.id + '">Anular</button>' : '') + (an && p.motivoAnulacion ? '<br><span class="small muted">' + esc(p.motivoAnulacion) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>') +
    (S.anularId && P && P.find(x => x.id === S.anularId) ? '<div class="col" style="gap:8px;border:2px solid #B42318;border-radius:12px;padding:12px"><div class="strong">¿Anular el recibo ' + esc(P.find(x => x.id === S.anularId).recibo) + '?</div><div class="small">El conductor vuelve a quedar con el próximo pago del ' + fmtYmd(P.find(x => x.id === S.anularId).pagadoHastaAntes || P.find(x => x.id === S.anularId).desde) + '. El recibo queda marcado como anulado (no se borra) y deja de sumar en Ingresos.</div><div class="field"><label for="anm">Motivo</label><input type="text" id="anm" data-in="anMotivo" maxlength="80" placeholder="Ej. registrado por error" value="' + fv('anMotivo') + '"></div><div class="row"><button class="btn btn-danger btn-sm" style="flex:1;min-height:44px" data-act="pagAnular"' + busyAttr() + '>Sí, anular</button><button class="btn btn-ghost btn-sm" style="flex:1;min-height:44px" data-act="pagAnularAsk" data-v="">Cancelar</button></div></div>' : '') + '</section>';
  const atraso = s.pagadoHasta < (S.f.pagFecha || ymd(new Date())), desde = atraso && S.f.pagDesde === 'hoy' ? S.f.pagFecha : s.pagadoHasta, hasta = finPeriodo(desde, s.plan), otro = Math.max(0, parseMoney(S.f.pagOtro) || 0), total = Math.max(0, val - dr - otro);
  const der = '<section class="card"><h2 class="h2">Registrar pago</h2><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + dateIn('pgf', 'pagFecha', 'Fecha del pago') +
    '<div class="field"><span class="lbl">Medio de pago</span><div class="chips">' + MEDIOS.map(m => fchip('pagMedio', m, m)).join('') + '</div></div></div>' +
    (atraso ? '<div class="field"><span class="lbl">El pago está atrasado desde el ' + fmtYmd(s.pagadoHasta) + '. ¿Desde cuándo cuenta?</span><div class="chips">' + fchip('pagDesde', '', 'Desde el vencimiento (cobra lo atrasado)') + fchip('pagDesde', 'hoy', 'Desde la fecha del pago') + '</div></div>' : '') +
    '<div class="field"><span class="lbl">Periodo que cubre</span><div style="min-height:46px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--field)">' + fmtYmd(desde) + ' al ' + fmtYmd(hasta) + '</div></div>' +
    '<div class="col" style="gap:8px;background:var(--field);border-radius:12px;padding:12px 14px"><div class="row between"><span>Plan ' + planTxt(s.plan).toLowerCase() + '</span><span>' + money(val) + '</span></div>' +
    '<div class="row between" style="color:var(--ok-ink)"><span>Descuento por referido' + ((s.refPend || []).length ? ' (' + (s.refPend || []).length + ')' : '') + '</span><span>' + (dr ? '−' + money(dr) : 'Ninguno por aplicar') + '</span></div>' +
    '<div class="row between"><label for="pgo">Otro descuento</label><input type="text" id="pgo" inputmode="numeric" data-in="pagOtro" data-live="1" value="' + fv('pagOtro') + '" placeholder="$0" style="width:120px;min-height:38px;text-align:right"></div>' +
    '<div class="row between" style="border-top:1px solid var(--line);padding-top:8px;font-weight:800;font-size:17px"><span>Total a recibir</span><span>' + money(total) + '</span></div></div>' +
    '<div class="field"><label for="pgm">Motivo del otro descuento (opcional)</label><input type="text" id="pgm" data-in="pagMotivo" maxlength="80" placeholder="Ej. promoción de fiestas" value="' + fv('pagMotivo') + '"></div>' +
    '<button class="btn btn-gold" data-act="pagSave"' + busyAttr() + '>Guardar pago y recibo</button></section>';
  return h + '<div class="sus-cols"><div class="col" style="gap:16px">' + izq + '</div>' + der + '</div>';
}
function admTarifas() {
  const num = (k, l) => '<div class="field"><label for="t_' + k + '">' + l + '</label><input type="text" inputmode="numeric" id="t_' + k + '" data-in="t_' + k + '" value="' + fv('t_' + k) + '"></div>';
  const pct = S.f.t_refTipo === 'pct';
  return '<button class="link" data-act="admTab" data-v="suscripciones" style="align-self:flex-start">← Volver a suscripciones</button><div class="sus-cols">' +
    '<section class="card"><h2 class="h2">Tarifas de la suscripción</h2><span class="small muted">El conductor paga según su plan; lo cambias en su ficha.</span>' + num('semanal', 'Semanal ($)') + num('quincenal', 'Quincenal ($)') + num('mensual', 'Mensual ($)') +
    '<div class="field"><label for="t_ins">Instrucciones de pago para el conductor</label><textarea id="t_ins" data-in="t_instrucciones" maxlength="300">' + fv('t_instrucciones') + '</textarea></div></section>' +
    '<div class="col" style="gap:16px"><section class="card"><h2 class="h2">Periodo gratis y mora</h2>' + num('diasGratis', 'Días gratis desde la inscripción') + num('diasGracia', 'Días de gracia después del vencimiento') + '<span class="small muted">Pasados los días de gracia, el conductor no puede conectarse hasta que registres su pago.</span></section>' +
    '<section class="card"><h2 class="h2">Descuento por referido</h2><div class="chips">' + [['fijo', 'Valor fijo'], ['pct', 'Porcentaje']].map(x => '<button class="chip" data-act="tRefTipo" data-v="' + x[0] + '" aria-pressed="' + ((S.f.t_refTipo || 'fijo') === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' + num('refValor', pct ? 'Porcentaje del plan (%)' : 'Valor del descuento ($)') +
    '<span class="small muted">Se descuenta al conductor que refirió, en su siguiente pago, cuando el referido hace su primer pago.</span></section></div></div>' +
    '<button class="btn btn-gold" style="max-width:320px" data-act="tSave"' + busyAttr() + '>Guardar cambios</button>';
}
function admIngresos() {
  let h = '<section class="card"><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + dateIn('ini', 'ingIni', 'Desde') + dateIn('inf', 'ingFin', 'Hasta') + '</div><div class="row" style="flex-wrap:wrap;gap:8px">' +
    [['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año']].map(x => '<button class="chip" data-act="ingRango" data-v="' + x[0] + '">' + x[1] + '</button>').join('') +
    '<button class="btn btn-navy btn-sm" data-act="ingLoad"' + busyAttr() + '>Consultar</button><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-act="ingOtroToggle" aria-expanded="' + !!S.ingOtro + '">+ Otro ingreso</button><button class="btn btn-ghost btn-sm" data-act="ingCsv">Descargar Excel</button></div>';
  if (S.ingOtro) h += '<div class="col" style="gap:8px;border-top:1px solid var(--line);padding-top:10px"><div class="strong small">Registrar otro ingreso</div><div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="field"><label for="oic">Concepto</label><input type="text" id="oic" data-in="oiConcepto" maxlength="80" placeholder="Ej. publicidad de una tienda" value="' + fv('oiConcepto') + '"></div><div class="field"><label for="oiv">Valor ($)</label><input type="text" id="oiv" inputmode="numeric" data-in="oiValor" value="' + fv('oiValor') + '"></div></div>' +
    '<div class="grid3" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + dateIn('oif', 'oiFecha', 'Fecha') + '<div class="field"><span class="lbl">Medio</span><div class="chips">' + MEDIOS.map(m => fchip('oiMedio', m, m)).join('') + '</div></div></div><button class="btn btn-gold btn-sm" style="align-self:flex-start;min-height:44px" data-act="ingOtroSave"' + busyAttr() + '>Guardar ingreso y recibo</button></div>';
  h += '</section>';
  const L = S.ingresos; if (!L) return h + '<div class="spinner" role="status" aria-label="Cargando"></div>';
  const V = L.filter(p => !p.anulado), neto = V.reduce((a, p) => a + (p.neto || 0), 0), desc = V.reduce((a, p) => a + (p.descRef || 0) + (p.descOtro || 0), 0);
  const moraVal = Object.values(S.susMap || {}).filter(s => { const e = susEstado(s); return e && (e.k === 'gracia' || e.k === 'mora'); }).reduce((a, s) => a + (tarifas()[s.plan] || 0), 0);
  h += '<div class="kpis"><div class="card kpi navy"><span class="k">Ingresos netos</span><span class="v">' + money(neto) + '</span></div><div class="card kpi"><span class="k">Pagos recibidos</span><span class="v">' + V.length + '</span></div><div class="card kpi"><span class="k">Descuentos otorgados</span><span class="v">' + money(desc) + '</span></div><div class="card kpi alert"><span class="k">Por cobrar (mora)</span><span class="v">' + (S.susMap ? money(moraVal) : '…') + '</span></div></div>';
  if (!L.length) return h + '<div class="card"><div class="muted">No hay ingresos en ese periodo.</div></div>';
  const porMedio = {}; V.forEach(p => { porMedio[p.medio] = (porMedio[p.medio] || 0) + (p.neto || 0); });
  const conc = p => (p.tipo === 'otro' ? 'Otro ingreso · ' + esc(p.concepto) : esc(p.nombre) + ' · ' + planTxt(p.plan).toLowerCase()) + (p.anulado ? ' <span class="pill p-danger">Anulado</span>' : '');
  const desTxt = p => { const d = (p.descRef || 0) + (p.descOtro || 0); return d ? '<span class="small" style="color:var(--ok-ink)">−' + money(d) + (p.descRef ? ' referido' : '') + (p.descOtro ? (p.descRef ? ' + otro' : ' ' + esc(p.motivo || 'descuento')) : '') + '</span>' : '—'; };
  const mov = isWide() ? '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th scope="col">Fecha</th><th scope="col">Recibo</th><th scope="col">Concepto</th><th scope="col">Valor</th><th scope="col">Descuento</th><th scope="col">Neto</th><th scope="col">Medio</th></tr></thead><tbody>' +
    L.map(p => '<tr><td>' + fmtYmd(p.fecha).slice(0, 5) + '</td><td>' + esc(p.recibo) + '</td><td>' + conc(p) + '</td><td>' + money(p.valor || 0) + '</td><td>' + desTxt(p) + '</td><td class="strong"' + (p.anulado ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + money(p.neto || 0) + '</td><td>' + esc(p.medio) + '</td></tr>').join('') + '</tbody></table></div>'
    : L.map(p => '<div class="col" style="gap:2px;padding:8px 0;border-bottom:1px solid var(--line)"><div class="row between"><span class="strong small">' + conc(p) + '</span><span class="strong">' + money(p.neto || 0) + '</span></div><span class="small muted">' + fmtYmd(p.fecha) + ' · ' + esc(p.recibo) + ' · ' + esc(p.medio) + '</span>' + ((p.descRef || p.descOtro) ? desTxt(p) : '') + '</div>').join('');
  return h + '<div class="ing-cols"><section class="card"><h2 class="h2">Movimientos</h2>' + mov + '</section><section class="card"><h2 class="h2">Por medio de pago</h2>' + Object.keys(porMedio).map(m => '<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>' + esc(m) + '</span><span class="strong">' + money(porMedio[m]) + '</span></div>').join('') + '</section></div>';
}
async function loadIngresos() {
  const hoy = new Date();
  if (!S.f.ingIni) S.f.ingIni = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (!S.f.ingFin) S.f.ingFin = ymd(hoy);
  if (S.f.ingFin < S.f.ingIni) { S.err = 'La fecha final no puede ser anterior a la inicial.'; render(); return; }
  S.ingresos = null; render();
  try { const qs = await getDocs(query(collection(db, 'pagos'), where('fecha', '>=', S.f.ingIni), where('fecha', '<=', S.f.ingFin), limit(2000))); S.ingresos = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.recibo).localeCompare(String(a.recibo))); }
  catch (e) { S.ingresos = []; S.err = errMsg(e); }
  if (S.screen === 'admin') render();
}
async function loadPagosMes() {
  const hoy = new Date(), a = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), b = ymd(hoy);
  try { const qs = await getDocs(query(collection(db, 'pagos'), where('fecha', '>=', a), where('fecha', '<=', b), limit(2000))); S.pagosMes = qs.docs.map(d => d.data()).filter(p => !p.anulado); } catch (e) { S.pagosMes = []; }
  if (S.screen === 'admin') render();
}
async function loadSusPagos(cid) {
  S.susPagos = null;
  try { const qs = await getDocs(query(collection(db, 'pagos'), where('cid', '==', cid), limit(200))); S.susPagos = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.recibo).localeCompare(String(a.recibo))); } catch (e) { S.susPagos = []; S.err = errMsg(e); }
  if (S.screen === 'admin') render();
}
// Recibo consecutivo JNF-0001 (contador en config/contador) y registro del pago en una sola transacción
async function guardarPago(datos, extra) {
  let recibo = '';
  await runTransaction(db, async tx => {
    const cref = doc(db, 'config', 'contador'), cs = await tx.get(cref), n = (cs.exists() ? cs.data().n || 0 : 0) + 1;
    recibo = 'JNF-' + String(n).padStart(4, '0');
    tx.set(cref, { n });
    tx.set(doc(collection(db, 'pagos')), Object.assign({ recibo, creado: serverTimestamp() }, datos));
    if (extra) extra(tx);
  });
  return recibo;
}
function vSinConexion() { return '<div class="screen"><div class="pad" style="flex:1;justify-content:center"><img src="' + LOGO + '" alt="Logo JNF S.A.S." style="width:88px;height:88px;align-self:center"><div class="card"><div class="h2">No pudimos conectar con el servidor</div><div class="muted">' + esc(S.connErr || '') + '</div><button class="btn btn-gold" data-act="retryLogin">Reintentar</button><button class="link" data-act="logout" style="align-self:center">Cerrar sesión</button></div></div></div>'; }
const V = {
  sinConexion: vSinConexion,
  cancelar: vCancelar,
  cargando: vCargando, login: vLogin, onboarding: vOnboarding, home: vHome, buscando: vBuscando, viaje: vViaje, calificar: vCalificar,
  menu: vMenu, historial: vHistorial, contactos: vContactos, registroC: vRegistroC, solicitudes: vSolicitudes, espera: vEspera, cviaje: vCViaje,
  ccalificar: vCCalificar, micalif: vMiCalif, admin: vAdmin, transfer: vTransfer, notif: vNotif,
  suscripcion: vMiSus,
  ayuda: () => vTexto('Ayuda y soporte', '<div class="h2">¿Necesitas ayuda?</div><div class="muted">Comunícate con Asesorías y Consultorías JNF S.A.S. al 310 657 1274 o al 311 302 8402, o visítanos en la Cra. 13 N° 10-01, Of. 1.</div>'),
  terminos: vTerminos
};

/* ---------- mapa (Leaflet + OpenStreetMap), íconos y rutas (OSRM) ---------- */
const GOLD = '#C9A227', GREEN = '#1F6F43', GREY = '#8A919E';
// Azul que se adapta al tema: marino en modo claro, azul claro en modo oscuro (variable --route del tema)
const navyCol = () => (getComputedStyle(document.documentElement).getPropertyValue('--route') || '').trim() || '#1A2580';
const ICON = {
  carro: '<rect x="9" y="5" width="30" height="5" rx="2.5" fill="currentColor"/><path d="M12 40 V19 C12 13 16.5 9 22 9 H26 C31.5 9 36 13 36 19 V40 Z" fill="currentColor"/><path d="M16 14 H32 V23 H16 Z" fill="#fff"/><circle cx="24" cy="30" r="3" fill="#fff"/><rect x="21" y="38" width="6" height="8" rx="3" fill="currentColor"/><rect x="10" y="36" width="4" height="7" rx="2" fill="currentColor"/><rect x="34" y="36" width="4" height="7" rx="2" fill="currentColor"/>',
  person: '<ellipse cx="24" cy="44" rx="11" ry="3.2" fill="currentColor" opacity=".35"/><circle cx="24" cy="7" r="4.4" fill="currentColor"/><path d="M17.8 13.5 H30.2 C31.2 13.5 32 14.3 32 15.3 V26.5 H28.4 V41 H25.2 V30 H22.8 V41 H19.6 V26.5 H16 V15.3 C16 14.3 16.8 13.5 17.8 13.5 Z" fill="currentColor"/>',
  flag: '<path d="M12 44 V6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 7 H37 L31 15 L37 23 H12 Z" fill="currentColor"/>'
};
// ax/ay: punto del ícono que marca la ubicación exacta (base de las ruedas, pies, pie del asta)
const KIND = {
  moto: () => ({ d: ICON.carro, col: GOLD, w: 46, op: 1, ax: 0.5, ay: 0.93 }),
  otro: () => ({ d: ICON.carro, col: GREY, w: 32, op: 0.55, ax: 0.5, ay: 0.93 }),
  person: () => ({ d: ICON.person, col: navyCol(), w: 42, op: 1, ax: 0.5, ay: 0.9 }),
  dest: () => ({ d: ICON.flag, col: GREEN, w: 40, op: 1, ax: 16 / 60, ay: 48 / 56 })
};
function iconSVG(k, w) {
  const s = KIND[k](), W = w || s.w, H = Math.round(W * 56 / 60);
  return '<svg class="jm-ico" data-kind="' + k + '" width="' + W + '" height="' + H + '" viewBox="-4 -4 60 56" aria-hidden="true" style="color:' + s.col + ';opacity:' + s.op + ';overflow:visible;display:block;flex-shrink:0"><g class="halo">' + s.d + '</g>' + s.d + '</svg>';
}
const badge = (k, px) => iconSVG(k, px);
const pickupOf = v => v && v.origen && v.origen.lat != null ? { lat: v.origen.lat, lng: v.origen.lng } : null;
const destOf = v => v && v.destino && v.destino.lat != null ? { lat: v.destino.lat, lng: v.destino.lng } : null;
// Marcadores de cada pantalla: [clave, posición, tipo, etiqueta]
function mapPoints() {
  const v = S.viaje, st = v && v.estado, m = [];
  if (S.screen === 'home') { if (S.pos) m.push(['me', S.pos, 'person', 'Tú']); if (S.destPin) m.push(['dest', S.destPin, 'dest', 'Destino']); }
  if (S.screen === 'buscando') { const c = pickupOf(v) || S.pos; if (c) m.push(['me', c, 'person', 'Tú']); S.ofertas.forEach(o => { const p = livePos(o.id) || (o.lat != null ? { lat: o.lat, lng: o.lng } : null); if (p) m.push(['of_' + o.id, p, 'oferta', money(o.precio)]); }); }
  if (S.screen === 'solicitudes' && S.reqMap) { const r = S.requests.find(x => x.id === S.reqMap); if (r) { const p = pickupOf(r), d = destOf(r); if (p) m.push(['pax', p, 'person', 'Pasajero']); if (d) m.push(['dest', d, 'dest', 'Destino']); if (S.pos) m.push(['me', S.pos, 'moto', 'Tú']); } }
  if (S.screen === 'viaje') {
    const me = S.pos || pickupOf(v); if (me && REC(st)) m.push(['me', me, 'person', 'Tú']);
    if (S.drvPos) m.push(['drv', S.drvPos, 'moto', 'Tu conductor']);
    if (st === 'en_curso' && !v.devolucion && destOf(v)) m.push(['dest', destOf(v), 'dest', esEnvio(v) ? 'Entrega' : 'Destino']);
    if (st === 'en_curso' && v.devolucion && pickupOf(v)) m.push(['dest', pickupOf(v), 'dest', 'Devolución']);
  }
  if (S.screen === 'cviaje') {
    if (S.pos) m.push(['me', S.pos, 'moto', 'Tú']);
    if (REC(st)) { const p = S.paxPos || pickupOf(v); if (p) m.push(['pax', p, 'person', esEnvio(v) ? 'Quien envía' : 'Pasajero']); }
    const dd = v && v.devolucion ? pickupOf(v) : destOf(v);
    if (st === 'en_curso' && dd) m.push(['dest', dd, 'dest', v.devolucion ? 'Devolución' : esEnvio(v) ? 'Entrega' : 'Destino']);
  }
  return m;
}
function mountMap() {
  const el = document.getElementById('map'); if (!el || !window.L) return;
  const pts = mapPoints(); mk = {};
  if (!pts.length) { el.innerHTML = '<div class="muted small" style="padding:16px">Esperando la ubicación GPS…</div>'; return; }
  const L = window.L;
  map = L.map(el, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false }).setView([pts[0][1].lat, pts[0][1].lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  pts.forEach(p => setMarker(p[0], p[1], p[2], p[3]));
  const zc = S.screen === 'buscando' ? zoneCenter() : null;
  if (zc) mk.zone = L.circle([zc.lat, zc.lng], { radius: RADIO_KM * 1000, color: navyCol(), weight: 2, opacity: 0.45, dashArray: '7 7', fillColor: navyCol(), fillOpacity: 0.07, interactive: false }).addTo(map);
  syncOthers(); drawRoute(); fitMap();
  if (S.screen === 'home') map.on('click', e => { if (!S.pickDest) return; S.destPin = { lat: e.latlng.lat, lng: e.latlng.lng }; S.pickDest = false; S.route = null; render(); });
  if (S.screen === 'home' && S.pickDest) el.style.cursor = 'crosshair';
}
function setMarker(key, pos, kind, label) {
  if (!map || !pos || !window.L || !document.getElementById('map')) return;
  if (mk[key]) { mk[key].setLatLng([pos.lat, pos.lng]); return; }
  if (kind === 'oferta') {
    const s = KIND.moto(), W = s.w, H = Math.round(W * 56 / 60), TW = 96;
    const icon = window.L.divIcon({ className: 'jm-icon', html: '<div class="jm-of"><span class="jm-tag">' + esc(label) + '</span>' + iconSVG('moto') + '</div>', iconSize: [TW, H + 30], iconAnchor: [TW / 2, Math.round(30 + H * s.ay)] });
    mk[key] = window.L.marker([pos.lat, pos.lng], { icon, keyboard: false, zIndexOffset: 800, title: 'Oferta ' + label, alt: 'Oferta ' + label }).addTo(map);
    return;
  }
  const s = KIND[kind](), W = s.w, H = Math.round(W * 56 / 60);
  const icon = window.L.divIcon({ className: 'jm-icon', html: iconSVG(kind), iconSize: [W, H], iconAnchor: [Math.round(W * s.ax), Math.round(H * s.ay)] });
  mk[key] = window.L.marker([pos.lat, pos.lng], { icon, keyboard: false, zIndexOffset: kind === 'otro' ? 0 : 500, title: label, alt: label }).addTo(map).bindTooltip(label);
}
function removeMarker(key) { if (mk[key] && map) { map.removeLayer(mk[key]); delete mk[key]; } }
// Otros conductores conectados: motos grises y semitransparentes
function syncOthers() {
  if (!map) return;
  const keep = {}, me = S.user && S.user.uid, assigned = S.viaje && S.viaje.conductorId, zc = zoneCenter();
  const withOffer = {}; if (S.screen === 'buscando') S.ofertas.forEach(o => { withOffer[o.id] = money(o.precio); });
  const show = S.screen === 'home' || S.screen === 'buscando' || S.screen === 'viaje' || S.screen === 'cviaje' || (S.screen === 'solicitudes' && S.reqMap);
  if (show) Object.keys(S.others || {}).forEach(uid => {
    const p = livePos(uid);
    if (!p || uid === me || uid === assigned) return;
    if (withOffer[uid]) { setMarker('of_' + uid, p, 'oferta', withOffer[uid]); return; }
    if (zc && distKm(zc, p) > RADIO_KM) return;
    keep['o_' + uid] = true; setMarker('o_' + uid, p, 'otro', 'Conductor en tu zona');
  });
  Object.keys(mk).forEach(k => { if (k.indexOf('o_') === 0 && !keep[k]) removeMarker(k); });
  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = zoneCount(); });
  if (S.screen === 'buscando') S.ofertas.forEach(o => { const e = offerEta(o); if (!e) return; document.querySelectorAll('[data-ofmin="' + o.id + '"]').forEach(el => { el.textContent = e.min; }); document.querySelectorAll('[data-ofkm="' + o.id + '"]').forEach(el => { el.textContent = fmtDist(e.km); }); });
}
function fitMap() {
  if (!map || !window.L) return;
  if (mk.zone && S.screen === 'buscando') { map.fitBounds(mk.zone.getBounds(), { padding: [8, 8], animate: false }); return; }
  const ll = Object.keys(mk).filter(k => k !== 'route' && k !== 'zone' && k.indexOf('o_') !== 0).map(k => mk[k].getLatLng());
  if (mk.route) ll.push(...mk.route.getLatLngs());
  if (ll.length >= 2) map.fitBounds(window.L.latLngBounds(ll), { padding: [44, 44], maxZoom: 17, animate: false });
}
// Tramo que se dibuja: recogida mientras está asignado; destino durante el viaje; vista previa en el inicio
function routeEnds() {
  const v = S.viaje, st = v && v.estado;
  if (S.screen === 'home') return [S.pos, S.destPin];
  const fin = v && v.devolucion ? pickupOf(v) : destOf(v);
  if (S.screen === 'viaje') return REC(st) ? [S.drvPos, S.pos || pickupOf(v)] : st === 'en_curso' ? [S.drvPos || (esEnvio(v) ? null : S.pos), fin] : [null, null];
  if (S.screen === 'cviaje') return REC(st) ? [S.pos, S.paxPos || pickupOf(v)] : st === 'en_curso' ? [S.pos, fin] : [null, null];
  return [null, null];
}
const routeActive = () => { const e = routeEnds(); return !!(e[0] && e[1]) || (S.screen !== 'home' && S.viaje && REC(S.viaje.estado)); };
function drawRoute() {
  if (!map || !window.L) return;
  if (mk.route) { map.removeLayer(mk.route); delete mk.route; }
  const e = routeEnds();
  if (S.route && e[0] && e[1] && S.route.key === routeKey()) mk.route = window.L.polyline(S.route.coords, { color: S.route.straight ? '#8A93B8' : navyCol(), weight: 5, opacity: 0.85, dashArray: S.route.straight ? '8 8' : null }).addTo(map);
}
const routeKey = () => S.screen + ':' + (S.viaje ? S.viaje.estado + (S.viaje.devolucion ? ':dev' : '') : 'previa');
let routeBusy = false;
async function refreshRoute() {
  if (routeBusy) return;
  const [a, b] = routeEnds(); if (!a || !b) return;
  const r = S.route, key = routeKey();
  if (r && r.key === key && distKm(r.from, a) < 0.15 && distKm(r.to, b) < 0.05 && Date.now() - r.at < 60000) return;
  routeBusy = true;
  try {
    const res = await fetch('https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson');
    const j = await res.json(); const rt = j && j.routes && j.routes[0]; if (!rt) throw new Error('sin ruta');
    S.route = { key, coords: rt.geometry.coordinates.map(c => [c[1], c[0]]), dist: rt.distance / 1000, dur: rt.duration / 60, from: a, to: b, at: Date.now() };
  } catch (e) {
    S.route = { key, coords: [[a.lat, a.lng], [b.lat, b.lng]], dist: distKm(a, b), dur: null, straight: true, from: a, to: b, at: Date.now() };
  }
  routeBusy = false; drawRoute(); fitMap(); updateEta();
}
function etaText() {
  const r = S.route; if (r && r.key === routeKey() && r.dur != null) return Math.max(1, Math.round(r.dur)) + ' min · ' + fmtDist(r.dist);
  const e = routeEnds(), km = distKm(e[0], e[1]);
  return km != null ? fmtDist(km) + ' en línea recta' : 'Ubicando…';
}
function updateEta() { document.querySelectorAll('[data-eta]').forEach(el => { el.textContent = etaText(); }); }
function legendHTML(items) {
  const e = routeEnds(), withRoute = !!(e[0] && e[1]);
  return '<div class="row small" style="gap:14px;flex-wrap:wrap;padding:8px 16px;background:var(--surface);border-bottom:1px solid var(--line)">' +
    items.map(it => '<span class="row" style="gap:6px">' + badge(it[0], 22) + it[1] + '</span>').join('') +
    (withRoute ? '<span class="row" style="gap:6px"><span style="width:18px;height:4px;border-radius:2px;background:' + navyCol() + ';flex-shrink:0"></span>Ruta</span>' : '') + '</div>';
}
// Ubicaciones en vivo (conductores conectados y el pasajero del viaje)
function listenOthers() {
  addSub(onValue(ref(rtdb, 'ubicaciones'), snap => { S.others = snap.val() || {}; syncOthers(); }, () => { }));
}
// Búsqueda de dirección con Nominatim (OpenStreetMap), solo al tocar el botón
async function geocodeDestino(q) {
  let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=co&q=' + encodeURIComponent(q);
  if (S.pos) url += '&viewbox=' + (S.pos.lng - 0.08) + ',' + (S.pos.lat + 0.08) + ',' + (S.pos.lng + 0.08) + ',' + (S.pos.lat - 0.08) + '&bounded=1';
  const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  const j = await res.json();
  return j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) } : null;
}

/* ---------- render y navegación ---------- */
let lastWide = null;
window.addEventListener('resize', () => { const w = isWide(); if (S.screen === 'admin' && w !== lastWide) render(); });
function render() {
  lastWide = isWide(); appEl.classList.toggle('wide', S.screen === 'admin' && lastWide); applyMascTheme();
  if (map) { try { map.remove(); } catch (e) { } map = null; }
  appEl.innerHTML = V[S.screen]();
  mountMap();
  const ends = routeEnds(); if (ends[0] && ends[1]) refreshRoute();
}
function go(s) { clearSubs(); if (S.banner && S.banner._seen) S.banner = null; S.screen = s; S.err = null; S.busy = false; render(); if (S.banner) S.banner._seen = true; window.scrollTo(0, 0); enter(s); }
function fail(e) { S.busy = false; S.err = errMsg(e); render(); }

/* ---------- geolocalización ---------- */
// Ubicación: primero la aproximada (red/wifi, llega en 1-2 s) y luego la precisa (satélite).
// Si falla, se informa la causa (permiso bloqueado, ubicación apagada, demora) y se sigue intentando en segundo plano.
const GPS_SCREENS = ['home', 'solicitudes'];
const inWebView = () => /; wv\)|FBAN|FBAV|Instagram|WhatsApp/i.test(navigator.userAgent);
function gpsMsg() {
  const c = S.gpsErr;
  if (c === 'nosoporta') return ['warn', 'Este navegador no permite usar la ubicación. Abre Motocaimán en Chrome.'];
  if (c === 1) return ['warn', inWebView() ? 'Estás usando el navegador interno de otra app (por ejemplo WhatsApp), que bloquea la ubicación. Toca ⋮ y elige "Abrir en Chrome".'
    : isStandalone() ? 'La ubicación está bloqueada para Motocaimán. En el celular ve a Ajustes → Aplicaciones → Chrome → Permisos → Ubicación → Permitir, y toca "Reintentar".'
      : 'Chrome tiene bloqueada la ubicación para Motocaimán. Toca el candado junto a la dirección → Permisos → Ubicación → Permitir, y toca "Reintentar".'];
  if (c === 2) return ['warn', 'Tu celular no está entregando la ubicación. Enciende la ubicación (GPS) en los ajustes rápidos del celular y toca "Reintentar".'];
  return ['info', 'El GPS está tardando en ubicarte. Seguimos intentando; bajo techo ayuda acercarse a una ventana. Mientras tanto, escribe la referencia del punto de recogida.'];
}
function gpsBanner() { if (S.gps !== 'error') return ''; const m = gpsMsg(); return '<div class="banner ' + m[0] + '" role="status">' + I.info + '<div class="grow">' + esc(m[1]) + '</div><button data-act="retryGps">Reintentar</button></div>'; }
function gpsFix(p) {
  const first = S.gps !== 'ok';
  S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.gps = 'ok'; S.gpsErr = null;
  if (first && GPS_SCREENS.includes(S.screen)) render(); else if (S.screen === 'home') setMarker('me', S.pos, 'person', 'Tú');
}
function gpsFail(code) { if (S.pos) return; S.gps = 'error'; S.gpsErr = code; if (GPS_SCREENS.includes(S.screen)) render(); }
function getGps() {
  if (!navigator.geolocation) { S.gps = 'error'; S.gpsErr = 'nosoporta'; render(); return; }
  S.gps = S.pos ? 'ok' : 'pendiente';
  let pend = 2, worst = 3;
  const err = e => { if (e && e.code === 1) { gpsFail(1); return; } if (e && e.code === 2) worst = 2; if (--pend === 0) gpsFail(worst); };
  navigator.geolocation.getCurrentPosition(gpsFix, err, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  navigator.geolocation.getCurrentPosition(gpsFix, err, { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 });
}
// Seguimiento en el inicio del pasajero: si el GPS se demora, el aviso desaparece solo cuando llega la ubicación
function homeWatch() {
  if (!navigator.geolocation) return;
  const id = navigator.geolocation.watchPosition(gpsFix, e => { if (e && e.code === 1) gpsFail(1); }, { enableHighAccuracy: true, maximumAge: 30000 });
  addSub(() => navigator.geolocation.clearWatch(id));
}
function gpsOnce(ms) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
    navigator.geolocation.getCurrentPosition(p => { if (done) return; done = true; clearTimeout(t); S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.gps = 'ok'; S.gpsErr = null; res(S.pos); },
      () => { if (done) return; done = true; clearTimeout(t); res(null); }, { enableHighAccuracy: false, timeout: ms, maximumAge: 120000 });
  });
}
function pushPos(force) {
  const now = Date.now();
  if (!S.pos || !S.user || !(S.online || S.sharing)) return;
  if (!force && now - lastPush < 10000) return;
  lastPush = now; set(ref(rtdb, 'ubicaciones/' + S.user.uid), { lat: S.pos.lat, lng: S.pos.lng, ts: rtdbTime(), rol: S.online ? 'conductor' : 'pasajero' }).catch(() => { });
}
function startWatch() {
  if (watchId != null || !navigator.geolocation) { pushPos(true); return; }
  if (!S.pos) navigator.geolocation.getCurrentPosition(p => { if (S.pos) return; S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; const was = S.gps; S.gps = 'ok'; S.gpsErr = null; pushPos(true); if (was === 'error' && GPS_SCREENS.includes(S.screen)) render(); }, () => { }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  watchId = navigator.geolocation.watchPosition(p => {
    const was = S.gps;
    S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.gps = 'ok'; S.gpsErr = null;
    if (was === 'error' && GPS_SCREENS.includes(S.screen)) render();
    pushPos(false);
    if (S.screen === 'cviaje') { setMarker('me', S.pos, 'moto', 'Tú'); refreshRoute(); updateEta(); }
    if (S.screen === 'viaje' && S.viaje && REC(S.viaje.estado)) { setMarker('me', S.pos, 'person', 'Tú'); refreshRoute(); updateEta(); }
    if (S.screen === 'solicitudes' && S.reqMap) setMarker('me', S.pos, 'moto', 'Tú');
  }, e => { if (e && (e.code === 1 || e.code === 2)) gpsFail(e.code); }, { enableHighAccuracy: true, maximumAge: 10000 });
  try { onDisconnect(ref(rtdb, 'ubicaciones/' + S.user.uid)).remove(); } catch (e) { }
  pushPos(true);
}
function stopWatch() {
  if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null; lastPush = 0;
  return S.user ? remove(ref(rtdb, 'ubicaciones/' + S.user.uid)).catch(() => { }) : Promise.resolve();
}
// Tonos (frecuencia Hz, duración s; 0 = silencio) y vibración (ms) de cada evento
const SND = {
  ok: { n: [[660, 0.09], [880, 0.13]], v: [40] },
  solicitud: { n: [[880, 0.14], [0, 0.05], [1175, 0.14], [0, 0.2], [880, 0.14], [0, 0.05], [1175, 0.16]], v: [200, 100, 200, 100, 200] },
  acepta: { n: [[784, 0.12], [988, 0.12], [1319, 0.24]], v: [120, 60, 120] },
  llego: { n: [[1047, 0.16], [0, 0.07], [1047, 0.16], [0, 0.07], [1319, 0.32]], v: [300, 120, 300, 120, 300] },
  fin: { n: [[1319, 0.12], [988, 0.12], [784, 0.28]], v: [150, 80, 150] },
  alerta: { n: [[440, 0.22], [0, 0.07], [330, 0.32]], v: [400, 150, 400] },
  sos: { n: [[988, 0.25], [740, 0.25], [988, 0.25], [740, 0.25], [988, 0.25], [740, 0.3]], v: [500, 200, 500, 200, 500] }
};
const soundOn = () => lsGet('jnfm_sonido') !== '0';
function sound(k) {
  const s = SND[k]; if (!s || !soundOn()) return;
  try { if (navigator.vibrate) navigator.vibrate(s.v); } catch (e) { }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime + 0.03;
    s.n.forEach(x => {
      const f = x[0], d = x[1];
      if (f) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + d + 0.03);
      }
      t += d;
    });
  } catch (e) { }
  S.lastSound = k;
}
function beep() { sound('solicitud'); }
// Sonido según el cambio de estado del viaje (yo = rol del que escucha)
function tripSound(v, yo) {
  const st = v.estado, mio = v.canceladoPor === (S.user && S.user.uid);
  if (st === 'cancelado') { sound(mio ? 'ok' : 'alerta'); return; }
  if (st === 'finalizado') { sound('fin'); return; }
  if (st === 'en_punto') { sound(yo === 'pasajero' ? 'llego' : 'ok'); return; }
  if (st === 'en_curso') { sound('ok'); return; }
  if (st === 'asignado') sound('acepta');
}

/* ---------- panel: personas registradas y su calidad (consultas de agregación: 1 lectura cada una) ---------- */
async function loadDriverTrips(cid) {
  S.admTrips[cid] = 'cargando'; render();
  try { const qs = await getDocs(query(collection(db, 'viajes'), where('conductorId', '==', cid), limit(2000))); S.admTrips[cid] = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); }
  catch (e) { S.admTrips[cid] = []; S.err = errMsg(e); }
  calcDriver(); render();
}
function calcDriver() {
  const T = S.admTrips[S.admDriver]; if (!Array.isArray(T)) { S.admRes = null; return; }
  const ini = fromYmd(S.f.admIni), fin = fromYmd(S.f.admFin, true);
  if (!ini || !fin) { S.err = 'Elige la fecha inicial y la fecha final.'; S.admRes = null; return; }
  if (ini > fin) { S.err = 'La fecha inicial no puede ser posterior a la fecha final.'; S.admRes = null; return; }
  S.err = null;
  const ts = v => tsMs(v.finalizadoEn || v.creado), inR = ms => ms >= ini.getTime() && ms <= fin.getTime();
  const fl = T.filter(v => v.estado === 'finalizado' && inR(ts(v))).sort((p, q) => ts(q) - ts(p));
  const canc = T.filter(v => v.estado === 'cancelado' && v.canceladoPor === S.admDriver && v.motivo !== 'no_se_presento' && inR(tsMs(v.canceladoEn || v.creado))).length; // no cuenta "el pasajero no se presentó"
  const sum = arr => arr.reduce((s, v) => s + (v.precioFinal || 0), 0);
  S.admRes = { fin: fl, canc, total: sum(fl), ef: sum(fl.filter(v => v.pago !== 'transferencia')), tr: sum(fl.filter(v => v.pago === 'transferencia')), ts, iniTxt: ini.toLocaleDateString('es-CO'), finTxt: fin.toLocaleDateString('es-CO') };
}
async function loadAdmKpi() {
  try {
    const [t, ap, pe] = await Promise.all([getCountFromServer(collection(db, 'usuarios')), getCountFromServer(query(collection(db, 'conductores'), where('estado', '==', 'aprobado'))), getCountFromServer(query(collection(db, 'conductores'), where('estado', '==', 'pendiente')))]);
    S.admKpi = { total: t.data().count, aprob: ap.data().count, pend: pe.data().count };
  } catch (e) { S.admKpi = { total: '—', aprob: '—', pend: '—' }; }
  if (S.screen === 'admin') render();
}
async function loadDocCounts() {
  for (const c of (S.adm.conductores || []).filter(x => x.estado === 'pendiente')) {
    if (S.admDocCount[c.id] != null) continue;
    try { S.admDocCount[c.id] = (await getCountFromServer(collection(db, 'conductores', c.id, 'documentos'))).data().count; } catch (e) { S.admDocCount[c.id] = 0; }
    if (S.screen === 'admin') render();
  }
}
async function loadAdmUsers() {
  try {
    const [t, ap, pe] = await Promise.all([getCountFromServer(collection(db, 'usuarios')), getCountFromServer(query(collection(db, 'conductores'), where('estado', '==', 'aprobado'))), getCountFromServer(query(collection(db, 'conductores'), where('estado', '==', 'pendiente')))]);
    S.admKpi = { total: t.data().count, aprob: ap.data().count, pend: pe.data().count };
  } catch (e) { S.admKpi = { total: '—', aprob: '—', pend: '—' }; }
  if (S.screen === 'admin') render();
  try {
    const qs = await getDocs(query(collection(db, 'usuarios'), limit(S.admLimit)));
    S.admUsers = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
  } catch (e) { S.admUsers = []; S.err = errMsg(e); }
  if (S.screen === 'admin') render();
  admQFill(S.admUsers);
}
function admAlerta(q, c) {
  if (!q) return false;
  const pc = q.tot ? Math.round(q.pen * 100 / q.tot) : null;
  return (pc != null && q.tot >= 3 && pc > (c ? 20 : 30)) || (q.pN >= 5 && q.pAvg < 4.2) || (q.cN >= 5 && q.cAvg < 4.2);
}
let _allUsersBusy = false;
async function loadAllUsers() {
  if (_allUsersBusy) return; _allUsersBusy = true;
  try {
    const qs = await getDocs(query(collection(db, 'usuarios'), limit(3000)));
    S.admAllUsers = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
  } catch (e) { S.admAllUsers = []; S.err = errMsg(e); }
  _allUsersBusy = false;
  if (S.screen === 'admin' && S.admTab === 'usuarios') render();
}
const _qBusy = new Set();
async function admQFill(list) {
  for (const u of list || []) {
    if (S.admQ[u.id] || _qBusy.has(u.id)) continue;
    _qBusy.add(u.id);
    try {
      const esC = (S.adm.conductores || []).some(c => c.id === u.id);
      const [p, cc, tot, pen] = await Promise.all([
        getAggregateFromServer(collection(db, 'usuarios', u.id, 'calificaciones'), { n: count(), avg: average('estrellas') }),
        esC ? getAggregateFromServer(collection(db, 'conductores', u.id, 'calificaciones'), { n: count(), avg: average('estrellas') }) : Promise.resolve(null),
        getCountFromServer(collection(db, 'stats', u.id, 'viajes')),
        getCountFromServer(query(collection(db, 'stats', u.id, 'viajes'), where('pen', '==', true)))]);
      S.admQ[u.id] = { pN: p.data().n, pAvg: p.data().avg || 0, cN: cc ? cc.data().n : 0, cAvg: cc ? cc.data().avg || 0 : 0, tot: tot.data().count, pen: pen.data().count };
    } catch (e) { S.admQ[u.id] = { pN: 0, pAvg: 0, cN: 0, cAvg: 0, tot: 0, pen: 0 }; }
    _qBusy.delete(u.id);
    if (S.screen === 'admin' && S.admTab === 'usuarios') render();
  }
}

/* ---------- cancelaciones: temporizadores, resultados, tasa y restricciones ---------- */
function startTick() { const id = setInterval(tick, 1000); addSub(() => clearInterval(id)); }
function tick() {
  const v = S.viaje;
  if (v && v.estado === 'en_punto') {
    const t = (Date.now() - tsMs(v.enPuntoEn)) / 1000;
    document.querySelectorAll('[data-timer="espera"]').forEach(el => { el.textContent = fmtClock(ESPERA_S - 10 - t); });
    document.querySelectorAll('[data-timerbar="espera"]').forEach(el => { el.style.width = Math.min(100, t / 3) + '%'; });
    const b = document.querySelector('[data-noshow]'); if (b && b.disabled && t >= ESPERA_S && !S.busy) render();
  }
  if (S.screen === 'cancelar') { const g = graceLeft(); document.querySelectorAll('[data-timer="gracia"]').forEach(el => { el.textContent = fmtClock(g); }); if (S._gWas > 0 && g <= 0) render(); S._gWas = g; }
  if (v && (S.screen === 'cviaje' || S.screen === 'viaje')) {
    const k = v.id + ':' + v.estado;
    if (S.screen === 'cviaje' && v.estado === 'asignado' && S._near !== k) { const d = distKm(S.pos, S.paxPos || pickupOf(v)); if (d != null && d <= 0.1) { S._near = k; sound('llego'); S.banner = { kind: 'ok', text: 'Estás en el punto de recogida. Toca "Llegué al punto".' }; render(); } }
    if (v.estado === 'en_curso' && S._near !== k) { const d = distKm(S.screen === 'cviaje' ? S.pos : (S.pos || S.drvPos), destOf(v)); if (d != null && d <= 0.15) { S._near = k; sound('llego'); S.banner = { kind: 'ok', text: S.screen === 'cviaje' ? 'Llegaste al destino. Toca "Finalizar viaje" y cobra.' : 'Estás llegando a tu destino.' }; render(); } }
  }
  if (S.screen === 'cviaje' && v && v.estado === 'asignado') { const btn = document.querySelector('[data-act="llegue"]'), live = S.paxPos || pickupOf(v), d = distKm(S.pos, live), cerca = !live || (d != null && d <= 0.1); if (btn && !S.busy && btn.disabled === cerca) render(); }
  document.querySelectorAll('[data-timer="block"]').forEach(el => { const u = +el.getAttribute('data-until'), s = (u - Date.now()) / 1000; if (s <= 0) render(); else el.textContent = s > 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : fmtClock(s); });
}
// Resultado de cada viaje aceptado (finalizado o cancelado) para la tasa de cancelación de ambos
function cancelMsg(v, yoRol) {
  const yo = v.canceladoPor === S.user.uid, pen = v.penalizaA || null;
  if (yo) return 'Cancelaste el viaje.' + (pen === yoRol ? ' Cuenta en tu tasa de cancelación.' : ' Sin penalización.');
  if (v.motivo === 'no_se_presento') return 'El conductor canceló porque no te presentaste en el punto. Cuenta en tu tasa de cancelación.';
  return (yoRol === 'pasajero' ? 'El conductor canceló el viaje. Puedes pedir otro.' : 'El pasajero canceló el viaje.') + (pen === yoRol ? '' : ' No afecta tu tasa.');
}
function writeStats(v) {
  if (!v || !v.conductorId || !v.id) return;
  [[v.pasajeroId, 'pasajero'], [v.conductorId, 'conductor']].forEach(([u, rol]) => {
    setDoc(doc(db, 'stats', u, 'viajes', v.id), { pen: (v.penalizaA || null) === rol, rol, ts: serverTimestamp() }).catch(() => { });
    delete S.rates[u];
  });
}
async function loadRate(uid) {
  if (S.rates[uid]) return S.rates[uid];
  try { const qs = await getDocs(query(collection(db, 'stats', uid, 'viajes'), orderBy('ts', 'desc'), limit(20))); S.rates[uid] = { items: qs.docs.map(d => d.data()) }; }
  catch (e) { S.rates[uid] = { items: [] }; }
  return S.rates[uid];
}
function rateOf(uid, rol) { const r = S.rates[uid]; if (!r) return null; const it = r.items.filter(x => x.rol === rol); if (it.length < 3) return { n: it.length, pct: null }; return { n: it.length, pct: Math.round(it.filter(x => x.pen).length * 100 / it.length) }; }
function ratePill(uid, rol) { const r = rateOf(uid, rol); if (!r || r.pct == null) return ''; return '<span class="pill ' + (r.pct < 10 ? 'p-ok' : r.pct < 20 ? 'p-warn' : 'p-danger') + '">Cancela ' + r.pct + ' %</span>'; }
function blockOf(uid, rol) {
  const r = S.rates[uid]; if (!r) return null; const now = Date.now();
  const pens = r.items.filter(x => x.rol === rol && x.pen && now - tsMs(x.ts) < 86400000).map(x => tsMs(x.ts)).sort((p, q) => q - p);
  if (pens.length < 3) return null;
  const until = pens[0] + (rol === 'pasajero' ? 30 * 60000 : 86400000);
  return until > now ? { until, n: pens.length } : null;
}
function blockCard(rol, bl) {
  const s = (bl.until - Date.now()) / 1000, t = s > 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : fmtClock(s);
  return rol === 'pasajero'
    ? '<div class="card" style="border:2px solid #B42318"><div class="h2">No puedes pedir viajes por ahora</div><div class="muted">Cancelaste ' + bl.n + ' viajes en las últimas 24 horas después del periodo de gracia.</div><div class="col" style="align-items:center;gap:4px"><span class="muted small strong">Podrás pedir de nuevo en</span><span class="amount" style="line-height:1.25" data-timer="block" data-until="' + bl.until + '">' + t + '</span></div></div>'
    : '<div class="card" style="border:2px solid #B42318"><div class="h2">Modo conductor pausado</div><div class="muted">Cancelaste ' + bl.n + ' viajes aceptados en las últimas 24 horas. Podrás conectarte de nuevo en <b data-timer="block" data-until="' + bl.until + '">' + t + '</b>.</div></div>';
}

/* ---------- sitios frecuentes (los 5 destinos más pedidos) ---------- */
/* ---------- notificaciones push (llegan con la app cerrada o el celular bloqueado) ---------- */
// La app guarda la suscripción del celular en push/{uid}; el servidor de avisos (Cloudflare) envía la notificación.
const VAPID_PUB = 'BNY_uJoib4neirs0Or0RM292gb2BmGzc2zv0MKoQ-s5Z9XKddk16NXskom4dsFS7BQ2V60AH6aU9zWLkutQlhF4';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushPerm = () => (!pushSupported() ? 'nosoporta' : Notification.permission);
function u8Key(b64) { const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4), bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function sameKey(sub) { try { const k = new Uint8Array(sub.options.applicationServerKey), m = u8Key(VAPID_PUB); return k.length === m.length && k.every((x, i) => x === m[i]); } catch (e) { return true; } }
async function pushSync(pedir) {
  if (!S.user || !pushSupported()) return false;
  try {
    if (Notification.permission === 'default' && pedir) await Notification.requestPermission();
    if (Notification.permission !== 'granted') { S.pushOk = false; return false; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8Key(VAPID_PUB) });
    const drv = !!(S.conductor && S.conductor.estado === 'aprobado'), online = drv && S.mode === 'conductor' && S.online, envios = drv && !!S.conductor.envios, txt = JSON.stringify(sub), key = txt + '|' + online + '|' + drv + '|' + envios;
    if (S._pushKey !== key) { await setDoc(doc(db, 'push', S.user.uid), { sub: txt, online, rol: drv ? 'conductor' : 'pasajero', envios, actualizado: serverTimestamp() }); S._pushKey = key; }
    S.pushOk = true; return true;
  } catch (e) { S.pushOk = false; return false; }
}
async function pushOffline() { if (!S.user || !S._pushKey) return; try { await updateDoc(doc(db, 'push', S.user.uid), { online: false, actualizado: serverTimestamp() }); } catch (e) { } S._pushKey = null; }
// Le pide al servidor que avise a la otra parte (el servidor verifica en Firestore que el evento ocurrió)
function avisar(tipo, viajeId, extra) {
  if (!S.pushUrl) return Promise.resolve(null);
  return fetch(S.pushUrl.replace(/\/+$/, '') + '/notificar', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ tipo, viajeId }, extra || {})), keepalive: true })
    .then(r => r.json()).catch(e => ({ error: 'No se pudo conectar con el servidor de avisos (' + (e.message || e) + ')' }));
}
// Al tocar la notificación de un registro, la app abre el panel en Conductores
function abrirPanel() {
  const q = new URLSearchParams(location.search).get('abrir'); if (q !== 'conductores') return false;
  history.replaceState(null, '', location.pathname); S.admTab = 'conductores'; S.f.admCEst = 'pendiente'; go('admin'); return true;
}
try { if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.abrir === 'conductores' && S.admin) { S.admTab = 'conductores'; S.f.admCEst = 'pendiente'; go('admin'); } }); } catch (e) { }
// La solicitud se avisa a los conductores por partes (el servidor responde con el siguiente tramo)
async function avisarSolicitud(vid) { let desde = null; for (let i = 0; i < 60; i++) { const r = await avisar('solicitud', vid, desde ? { desde } : null); desde = r && r.siguiente ? r.siguiente : null; if (!desde) break; } }
function pushCard(conductor) {
  if (!S.pushUrl) return '';
  const p = pushPerm();
  if (p === 'granted' && S.pushOk) return '';
  const para = conductor ? 'recibir solicitudes de pasajeros' : 'saber cuándo llegan ofertas y cuándo llega tu conductor';
  let b;
  if (p === 'nosoporta') b = isIOS() ? 'En iPhone, instala Motocaimán en la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde el ícono para activar las notificaciones.' : 'Este navegador no permite notificaciones. Abre Motocaimán en Chrome.';
  else if (p === 'denied') b = 'Las notificaciones están bloqueadas. Toca el candado junto a la dirección → Permisos → Notificaciones → Permitir, y vuelve a abrir la app.';
  else return '<div class="card" style="gap:8px;border:2px solid var(--gold)"><div class="strong">Activa las notificaciones</div><div class="muted small">Para ' + para + ' aunque la app esté cerrada o el celular bloqueado.</div><button class="btn btn-gold btn-sm" style="width:100%" data-act="pushOn">Activar notificaciones</button></div>';
  return '<div class="banner warn">' + I.info + '<div class="grow">' + esc(b) + '</div></div>';
}
function vNotif() {
  const p = pushPerm(), drv = S.conductor && S.conductor.estado === 'aprobado';
  const est = p === 'granted' && S.pushOk ? '<span class="pill p-ok">Activadas</span>' : p === 'denied' ? '<span class="pill p-danger">Bloqueadas</span>' : p === 'nosoporta' ? '<span class="pill p-warn">No disponibles</span>' : '<span class="pill p-warn">Sin activar</span>';
  let h = '<div class="screen">' + subTop('Notificaciones') + '<div class="pad">' + errHTML() + bannerHTML(S.banner);
  if (!S.pushUrl) return h + '<div class="card"><div class="muted">El administrador aún no ha configurado el servidor de avisos.</div></div></div></div>';
  h += '<div class="card"><div class="row between"><div class="h2">Estado</div>' + est + '</div><div class="muted small">' + (drv ? 'Te avisamos de cada solicitud nueva mientras estés "En línea", aunque la app esté cerrada o el celular bloqueado. También cuando un pasajero acepte tu oferta o cancele.' : 'Te avisamos cuando llegue una oferta, cuando tu conductor llegue y si cancela, aunque la app esté cerrada.') + '</div>';
  h += (p === 'granted' && S.pushOk) ? '<button class="btn btn-ghost" data-act="pushTest"' + busyAttr() + '>Enviarme una notificación de prueba</button>' : pushCard(drv) || '<button class="btn btn-gold" data-act="pushOn">Activar notificaciones</button>';
  if (S.admPushRes) h += '<div class="muted small" role="status">' + esc(S.admPushRes) + '</div>';
  h += '</div><div class="card"><div class="h2">¿No te llegan con el celular bloqueado?</div><div class="muted small">Algunos celulares (Xiaomi, Huawei, Oppo, Samsung) frenan las notificaciones para ahorrar batería. Revisa:</div>' +
    '<div class="small">1. Ajustes → Aplicaciones → Chrome → Batería → <b>Sin restricciones</b>.</div><div class="small">2. Ajustes → Aplicaciones → Chrome → Notificaciones → <b>Permitir</b>, con sonido.</div><div class="small">3. Que el celular no esté en "No molestar" ni en ahorro de batería extremo.</div></div>';
  return h + '</div></div>';
}
/* ---------- calificaciones ---------- */
async function loadRating(key, path) {
  if (S.ratings[key]) return S.ratings[key];
  try {
    const qs = await getDocs(query(collection(db, ...path), limit(100)));
    let sum = 0, n = 0; const dist = {}, items = [];
    qs.docs.forEach(d => { const x = d.data(); sum += x.estrellas; n++; dist[x.estrellas] = (dist[x.estrellas] || 0) + 1; items.push(x); });
    const r = { avg: (5 * 4.5 + sum) / (5 + n), raw: n ? sum / n : 0, n, dist, items: items.sort((a, b) => tsMs(b.creado) - tsMs(a.creado)) };
    S.ratings[key] = r; return r;
  } catch (e) { return null; }
}

/* ---------- entrada a cada pantalla ---------- */
function enter(s) {
  if (s === 'home') { if (S.sharing) { S.sharing = false; stopWatch(); } S.route = null; getGps(); homeWatch(); listenOthers(); pushSync(false).then(ok => { if (!ok && S.screen === 'home') render(); }); delete S.rates[S.user.uid]; loadRate(S.user.uid).then(() => { if (S.screen === 'home') render(); }); startTick(); }
  if (s === 'buscando') {
    S.sharing = true; startWatch(); listenOthers();
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId), d => {
      if (!d.exists()) return; S.viaje = Object.assign({ id: d.id }, d.data());
      if (S.viaje.estado === 'asignado') { tripSound(S.viaje, 'pasajero'); go('viaje'); return; }
      if (S.viaje.estado === 'cancelado') { sound('ok'); S.banner = { kind: 'info', text: 'Cancelaste la solicitud.' }; S.viajeId = null; go('home'); return; }
    }, fail));
    let nOf = null;
    addSub(onSnapshot(collection(db, 'viajes', S.viajeId, 'ofertas'), qs => {
      if (nOf !== null && qs.docs.length > nOf) sound('solicitud');
      nOf = qs.docs.length;
      S.ofertas = qs.docs.map(d => { const o = Object.assign({ id: d.id }, d.data()); const km = distKm(S.viaje && S.viaje.origen, o.lat != null ? o : null); o.distTxt = km != null ? fmtDist(km) : ''; return o; }).sort((a, b) => a.precio - b.precio || (((rateOf(a.id, 'conductor') || {}).pct || 0) - ((rateOf(b.id, 'conductor') || {}).pct || 0)));
      S.ofertas.forEach(o => { if (!S.ratings[o.id]) loadRating(o.id, ['conductores', o.id, 'calificaciones']).then(() => { if (S.screen === 'buscando') render(); }); if (!S.rates[o.id]) loadRate(o.id).then(() => { if (S.screen === 'buscando') { S.ofertas.sort((a, b) => a.precio - b.precio || (((rateOf(a.id, 'conductor') || {}).pct || 0) - ((rateOf(b.id, 'conductor') || {}).pct || 0))); render(); } }); });
      if (S.screen === 'buscando') render();
    }, fail));
  }
  if (s === 'cancelar') {
    startTick();
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId), d => {
      const prev = S.viaje && S.viaje.estado; S.viaje = Object.assign({ id: d.id }, d.data());
      if (!REC(S.viaje.estado)) { go(S.cancelBack || (S.cancelRol === 'conductor' ? 'cviaje' : 'viaje')); return; }
      if (prev !== S.viaje.estado) render();
    }, fail));
  }
  if (s === 'viaje') {
    listenOthers(); startTick();
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId), d => {
      const prev = S.viaje && S.viaje.estado; S.viaje = Object.assign({ id: d.id }, d.data());
      const st = S.viaje.estado;
      if (prev && prev !== st) tripSound(S.viaje, 'pasajero');
      if (st === 'finalizado') { writeStats(S.viaje); S.rating = 5; S.chips = {}; S.f.comentario = ''; go('calificar'); return; }
      if (st === 'cancelado') { writeStats(S.viaje); S.banner = { kind: 'warn', text: cancelMsg(S.viaje, 'pasajero') }; S.viajeId = null; S.viaje = null; go('home'); return; }
      if (prev !== st || esEnvio(S.viaje)) render();
    }, fail));
    addSub(onValue(ref(rtdb, 'ubicaciones/' + S.viaje.conductorId), snap => {
      const p = snap.val(); if (!p) return; const first = !S.drvPos; S.drvPos = { lat: p.lat, lng: p.lng };
      setMarker('drv', S.drvPos, 'moto', 'Tu conductor'); if (first) fitMap(); refreshRoute(); updateEta();
    }));
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId, 'privado', S.viaje.conductorId), d => { if (d.exists()) { S.cPhone = d.data().telefono; S.cTransfer = d.data().transferencia || null; render(); } }, () => { }));
    loadRating(S.viaje.conductorId, ['conductores', S.viaje.conductorId, 'calificaciones']).then(() => { if (S.screen === 'viaje') render(); });
    if (esEnvio(S.viaje) && (!S.envCod || !S.recibe)) {
      const vid = S.viajeId; S.envCod = S.envCod || null;
      Promise.all([getDoc(doc(db, 'viajes', vid, 'entrega', 'codigo')), getDoc(doc(db, 'viajes', vid, 'entrega', 'recibe'))])
        .then(([a, b]) => { if (S.viajeId !== vid) return; S.envCod = a.exists() ? a.data().c : ''; S.recibe = b.exists() ? b.data() : {}; if (S.screen === 'viaje') render(); })
        .catch(() => { S.envCod = ''; if (S.screen === 'viaje') render(); });
    }
    S.sharing = true; startWatch();
  }
  if (s === 'solicitudes') {
    listenOthers(); startTick(); pushSync(false).then(() => { if (S.screen === 'solicitudes') render(); });
    delete S.rates[S.user.uid]; loadRate(S.user.uid).then(() => { if (blockOf(S.user.uid, 'conductor') && S.online) { S.online = false; stopWatch(); } if (S.screen === 'solicitudes') render(); });
    loadStats(); if (S.idFalta == null) checkIdFalta();
    loadRating(S.user.uid, ['conductores', S.user.uid, 'calificaciones']).then(() => { if (S.screen === 'solicitudes') render(); });
    if (S.online) listenRequests();
  }
  if (s === 'espera') {
    addSub(onSnapshot(doc(db, 'viajes', S.espera.viajeId), d => {
      const v = d.data();
      if (v.estado === 'asignado' && v.conductorId === S.user.uid) { sound('acepta'); S.viajeId = d.id; S.viaje = Object.assign({ id: d.id }, v); go('cviaje'); return; }
      if (v.estado !== 'buscando') { if (!S.espera.perdida) sound('alerta'); S.espera.perdida = true; render(); }
    }, () => { S.espera.perdida = true; render(); }));
  }
  if (s === 'cviaje') {
    listenOthers(); startTick();
    const priv = { telefono: S.perfil.telefono, nombre: S.perfil.nombre }; if (S.perfil.transferencia) priv.transferencia = S.perfil.transferencia;
    setDoc(doc(db, 'viajes', S.viajeId, 'privado', S.user.uid), priv).catch(() => { });
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId), d => {
      const prev = S.viaje && S.viaje.estado; S.viaje = Object.assign({ id: d.id }, d.data());
      if (prev && prev !== S.viaje.estado) tripSound(S.viaje, 'conductor');
      if (S.viaje.estado === 'cancelado') { writeStats(S.viaje); S.banner = { kind: 'warn', text: cancelMsg(S.viaje, 'conductor') }; S.viajeId = null; go('solicitudes'); return; }
      if (S.viaje.estado === 'finalizado') { writeStats(S.viaje); S.rating = 5; S.chips = {}; go('ccalificar'); return; }
      if (prev !== S.viaje.estado || esEnvio(S.viaje)) render();
    }, fail));
    addSub(onSnapshot(doc(db, 'viajes', S.viajeId, 'privado', S.viaje.pasajeroId), d => { if (d.exists()) { S.pPhone = d.data().telefono; render(); } }, () => { }));
    if (esEnvio(S.viaje) && !S.recibe) { const vid = S.viajeId; getDoc(doc(db, 'viajes', vid, 'entrega', 'recibe')).then(d => { if (S.viajeId !== vid) return; S.recibe = d.exists() ? d.data() : {}; if (S.screen === 'cviaje') render(); }).catch(() => { S.recibe = {}; }); }
    loadRating('p_' + S.viaje.pasajeroId, ['usuarios', S.viaje.pasajeroId, 'calificaciones']).then(() => { if (S.screen === 'cviaje') render(); });
    addSub(onValue(ref(rtdb, 'ubicaciones/' + S.viaje.pasajeroId), snap => {
      const p = snap.val(); if (!p || !S.viaje || !REC(S.viaje.estado)) return; const first = !S.paxPos; S.paxPos = { lat: p.lat, lng: p.lng };
      setMarker('pax', S.paxPos, 'person', 'Pasajero'); if (first) fitMap(); refreshRoute(); updateEta();
    }));
    startWatch(); refreshRoute();
  }
  if (s === 'registroC' && S.conductor) { if (S.docsFor !== S.user.uid || S.cpriv === null) loadMyDocs(); }
  if (s === 'suscripcion') { S.misPagos = null; S.misRef = null; loadMiSus(); }
  if (s === 'micalif') { S.cal = null; delete S.ratings[S.user.uid]; loadRating(S.user.uid, ['conductores', S.user.uid, 'calificaciones']).then(r => { S.cal = r || { n: 0 }; if (S.screen === 'micalif') render(); }); }
  if (s === 'historial') {
    S.hist = null;
    Promise.all([getDocs(query(collection(db, 'viajes'), where('pasajeroId', '==', S.user.uid), limit(50))),
      S.conductor && S.conductor.estado === 'aprobado' ? getDocs(query(collection(db, 'viajes'), where('conductorId', '==', S.user.uid), limit(50))) : Promise.resolve({ docs: [] })])
      .then(([a, b]) => { S.hist = a.docs.map(d => Object.assign({ id: d.id, _rol: 'pasajero' }, d.data())).concat(b.docs.map(d => Object.assign({ id: d.id, _rol: 'conductor' }, d.data()))).sort((x, y) => tsMs(y.creado) - tsMs(x.creado)); if (S.screen === 'historial') render(); })
      .catch(fail);
  }
  if (s === 'admin') {
    listenOthers(); loadAdmKpi(); if (S.admTab === 'usuarios') loadAdmUsers(); if (S.admTab === 'mascaras' || S.admTab === 'mascEdit') loadMascAdmin(); if (S.admTab === 'viajes') loadAdmViajes(); if (S.admTab === 'notificaciones') loadAdmPush(); if (['suscripciones', 'susFicha', 'ingresos'].includes(S.admTab)) { loadPagosMes(); if (S.admTab === 'ingresos') loadIngresos(); }
    let nPend = null;
    addSub(onSnapshot(query(collection(db, 'conductores'), limit(200)), qs => { S.adm.conductores = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); const np = pendientes(); if (nPend !== null && np > nPend) { sound('solicitud'); S.banner = { kind: 'info', text: 'Nuevo conductor por aprobar. Revísalo en Conductores.' }; } nPend = np; if (S.screen === 'admin') render(); loadDocCounts(); if (S.admTab === 'conductores') loadAdmRates(); if (['suscripciones', 'susFicha', 'ingresos'].includes(S.admTab)) loadSus(); }, fail));
    let nAl = null;
    addSub(onSnapshot(query(collection(db, 'alertas'), where('estado', '==', 'activa'), limit(50)), qs => { if (nAl !== null && qs.docs.length > nAl) sound('sos'); nAl = qs.docs.length; S.adm.alertas = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => tsMs(b.creado) - tsMs(a.creado)); if (S.screen === 'admin') render(); }, fail));
    getDocs(query(collection(db, 'viajes'), limit(100))).then(qs => { S.adm.viajes = qs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => tsMs(b.creado) - tsMs(a.creado)); if (S.screen === 'admin') render(); }).catch(fail);
  }
}
function listenRequests() {
  let known = new Set(S.requests.map(r => r.id)), first = true;
  addSub(onSnapshot(query(collection(db, 'viajes'), where('estado', '==', 'buscando'), limit(30)), qs => {
    const now = Date.now();
    S.requests = qs.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .filter(v => v.pasajeroId !== S.user.uid && !S.ignored[v.id] && now - tsMs(v.creado) < 20 * 60 * 1000 && (!esEnvio(v) || (S.conductor && S.conductor.envios)))
      .sort((a, b) => tsMs(b.creado) - tsMs(a.creado));
    const fresh = S.requests.some(r => !known.has(r.id));
    if (fresh && !first) beep();
    first = false; known = new Set(S.requests.map(r => r.id));
    S.requests.forEach(r => { if (!S.rates[r.pasajeroId]) loadRate(r.pasajeroId).then(() => { if (S.screen === 'solicitudes') render(); }); });
    S.requests.forEach(r => { const k = 'p_' + r.pasajeroId; if (!S.ratings[k]) loadRating(k, ['usuarios', r.pasajeroId, 'calificaciones']).then(() => { if (S.screen === 'solicitudes') render(); }); });
    if (S.screen === 'solicitudes') render();
  }, fail));
  startWatch();
}
async function loadStats() {
  try {
    const qs = await getDocs(query(collection(db, 'viajes'), where('conductorId', '==', S.user.uid), limit(200)));
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const hoy = qs.docs.map(d => d.data()).filter(v => v.estado === 'finalizado' && tsMs(v.finalizadoEn || v.creado) >= d0.getTime());
    S.stats = { viajes: hoy.length, ganado: hoy.reduce((s, v) => s + (v.precioFinal || 0), 0) };
    if (S.screen === 'solicitudes') render();
  } catch (e) { S.stats = { viajes: 0, ganado: 0 }; }
}

/* ---------- sesión ---------- */
async function findActive(field, uid, estados) {
  try {
    const q1 = await getDocs(query(collection(db, 'viajes'), where(field, '==', uid), where('estado', 'in', estados), limit(1)));
    if (!q1.empty) return Object.assign({ id: q1.docs[0].id }, q1.docs[0].data());
    return null;
  } catch (e) {
    try {
      const q2 = await getDocs(query(collection(db, 'viajes'), where(field, '==', uid), limit(100)));
      const d = q2.docs.find(x => estados.includes(x.data().estado));
      return d ? Object.assign({ id: d.id }, d.data()) : null;
    } catch (e2) { return null; }
  }
}
async function afterLogin(user) {
  S.user = user; clearGSubs();
  try {
    const p = await getDoc(doc(db, 'usuarios', user.uid));
    if (!p.exists()) { S.f.nombre = user.displayName || ''; go('onboarding'); return; }
    S.perfil = p.data();
    try { S.admin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) { S.admin = false; }
    try { const cf = await getDoc(doc(db, 'config', 'app')); S.pushUrl = cf.exists() ? String(cf.data().pushUrl || '') : ''; } catch (e) { S.pushUrl = ''; }
    await loadTarifas();
    try { const sd = await getDoc(doc(db, 'suscripciones', user.uid)); S.sus = sd.exists() ? sd.data() : null; } catch (e) { S.sus = null; }
    gsubs.push(onSnapshot(doc(db, 'suscripciones', user.uid), d => { const antes = conductorBloqueado(); S.sus = d.exists() ? d.data() : null; const ahora = conductorBloqueado(); if (ahora && S.online) { S.online = false; S.requests = []; stopWatch(); pushSync(false); } if (antes && !ahora) S.banner = { kind: 'ok', text: 'Tu pago quedó registrado. Ya puedes conectarte.' }; if (antes !== ahora && ['solicitudes', 'suscripcion', 'menu'].includes(S.screen)) render(); }, () => { }));
    gsubs.push(onSnapshot(doc(db, 'conductores', user.uid), d => {
      const before = S.conductor && S.conductor.estado; S.conductor = d.exists() ? d.data() : null;
      const now = S.conductor && S.conductor.estado;
      if (before && before !== now && now === 'aprobado') { sound('acepta'); S.banner = { kind: 'ok', text: 'El administrador aprobó tu registro. Ya puedes usar el modo conductor.' }; if (S.screen === 'menu' || S.screen === 'home') render(); }
      if (before === 'aprobado' && now !== 'aprobado' && S.mode === 'conductor') { S.online = false; stopWatch(); S.mode = 'pasajero'; S.banner = { kind: 'warn', text: 'Tu modo conductor fue ' + now + '.' }; go('home'); }
    }, () => { }));
    // Retomar un viaje en curso (si la consulta falla, se continúa normalmente)
    const pv = await findActive('pasajeroId', user.uid, ['buscando', 'asignado', 'en_punto', 'en_curso']);
    if (pv) { S.viajeId = pv.id; S.viaje = pv; S.mode = 'pasajero'; go(pv.estado === 'buscando' ? 'buscando' : 'viaje'); return; }
    if (S.admin && abrirPanel()) return;
    const cond = await getDoc(doc(db, 'conductores', user.uid));
    if (cond.exists() && cond.data().estado === 'aprobado') {
      const cv = await findActive('conductorId', user.uid, ['asignado', 'en_punto', 'en_curso']);
      if (cv) { S.viajeId = cv.id; S.viaje = cv; S.mode = 'conductor'; S.online = true; go('cviaje'); return; }
      // Conductor aprobado: entra directo a Solicitudes y en línea (si tiene restricción por cancelaciones, enter() lo desconecta)
      if (conductorBloqueado()) { S.mode = 'conductor'; S.online = false; go('solicitudes'); return; }
      S.mode = 'conductor'; S.online = true; S.banner = { kind: 'ok', text: 'Entraste como conductor y estás en línea. Para pedir un viaje, abre el menú y elige "Modo pasajero".' }; go('solicitudes'); return;
    }
    go('home');
  } catch (e) { S.connErr = errMsg(e); go('sinConexion'); }
}
loadMasc();
onAuthStateChanged(auth, user => {
  if (user) afterLogin(user);
  else { clearSubs(); clearGSubs(); S.user = null; S.perfil = null; S.conductor = null; S.admin = false; S.mode = 'pasajero'; S.online = false; go('login'); }
});

/* ---------- eventos ---------- */
let liveT = null;
appEl.addEventListener('input', e => {
  const k = e.target.getAttribute('data-in'); if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (k === 'cOtro') { const id = e.target.getAttribute('data-id'); S.cOtro[id] = Object.assign(S.cOtro[id] || { open: true }, { val: v }); return; }
  S.f[k] = v;
  if (e.target.hasAttribute('data-live')) {
    clearTimeout(liveT); const id = e.target.id;
    liveT = setTimeout(() => { const el0 = document.getElementById(id), pos = el0 ? el0.selectionStart : null; S.admVPage = 20; render(); const el = document.getElementById(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } } }, 300);
  }
});
appEl.addEventListener('change', async e => {
  const k = e.target.getAttribute('data-in'); if (k && e.target.type === 'checkbox') { S.f[k] = e.target.checked; if (k.indexOf('force_') === 0 || k === 'amOk') render(); }
  if (e.target.getAttribute('data-mascup') && e.target.files && e.target.files[0] && S.me) {
    const file = e.target.files[0]; S.err = null; S.mascMsg = 'Procesando la imagen…'; render();
    try {
      const r = await prepMaskImage(file);
      S.me.img = r.img; S.me.colores = r.colores; S.me.src = await toBlobUrl(r.img); S.mascMsg = '';
      if (!S.me.opcion) S.me.opcion = 'C';
      render();
    } catch (err) { S.mascMsg = ''; S.err = err.message || 'No se pudo procesar la imagen.'; render(); }
    return;
  }
  const ad = e.target.getAttribute('data-admdocup');
  if (ad && e.target.files && e.target.files[0]) {
    const [cid, tipo] = ad.split(':'), cc = (S.adm.conductores || []).find(x => x.id === cid) || {}, nom = (docsReq(cc.idTipo).find(d => d[0] === tipo) || [0, 'Documento'])[1];
    S.err = null; S.admDocMsg = cid + '|Procesando ' + nom + '…'; render();
    try {
      const img = await compressImage(e.target.files[0]);
      S.admDocMsg = cid + '|Guardando ' + nom + '…'; render();
      await setDoc(doc(db, 'conductores', cid, 'documentos', tipo), { tipo, img, subido: serverTimestamp() });
      const m = Object.assign({}, S.admDocs[cid] && S.admDocs[cid] !== 'cargando' ? S.admDocs[cid] : {}); m[tipo] = img; S.admDocs[cid] = m;
      S.admDocCount[cid] = docsReq(cc.idTipo).filter(d => m[d[0]]).length; S.admDocMsg = ''; S.banner = { kind: 'ok', text: nom + ' adjuntado.' }; render();
    } catch (err) { S.admDocMsg = ''; S.err = err && err.code ? errMsg(err) : (err.message || 'No se pudo procesar la foto.'); render(); }
    return;
  }
  const t = e.target.getAttribute('data-docup');
  if (t && e.target.files && e.target.files[0]) {
    S.err = null; S.docMsg = 'Procesando la foto…'; render();
    try {
      const img = await compressImage(e.target.files[0]);
      S.docs[t] = { img, estado: 'local' };
      if (S.conductor && (S.conductor.estado !== 'aprobado' || ID_DOCS.includes(t))) {
        S.docMsg = 'Enviando la foto…'; render();
        await setDoc(doc(db, 'conductores', S.user.uid, 'documentos', t), { tipo: t, img, subido: serverTimestamp() });
        S.docs[t].estado = 'subido'; if (ID_DOCS.includes(t)) S.idFalta = null;
      }
      S.docMsg = ''; render();
    } catch (err) { S.docMsg = ''; S.err = err && err.code ? errMsg(err) : (err.message || 'No se pudo procesar la foto.'); render(); }
  }
});

async function act(a, v, b) {
  const uid = S.user && S.user.uid;
  switch (a) {
    case 'go':
      if (v === 'contactos') { S.f.cNombre = ''; S.f.cTel = ''; S.f.cErr = ''; }
      if (v === 'transfer') S.f.transferencia = S.perfil.transferencia || '';
      if (v === 'registroC' && !S.conductor && !S.f.drvTel) S.f.drvTel = S.perfil.telefono || '';
      go(v); break;
    case 'retryLogin': go('cargando'); afterLogin(S.user); break;
    case 'hideInstall': S.hideInstall = true; render(); break;
    case 'install':
      if (!installEvt) break;
      try { installEvt.prompt(); await installEvt.userChoice; } catch (e) { }
      installEvt = null; render(); break;
    case 'closeBanner': S.banner = null; render(); break;
    case 'shareRef': {
      const cod = codigoDe(S.conductor), txt = 'Inscríbete como conductor en Motocaimán con mi código ' + cod + ': https://janf1485.github.io/JNF-Moto/';
      try { if (navigator.share) { await navigator.share({ title: 'Motocaimán', text: txt }); break; } } catch (e) { break; }
      window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener'); break;
    }
    case 'pushOn': { const ok = await pushSync(true); S.banner = ok ? { kind: 'ok', text: 'Notificaciones activadas.' } : null; if (!ok && pushPerm() === 'denied') S.err = 'Las notificaciones quedaron bloqueadas. Toca el candado junto a la dirección → Permisos → Notificaciones → Permitir.'; else if (!ok && pushPerm() === 'granted') S.err = 'No se pudo activar el aviso en este celular. Intenta de nuevo.'; render(); break; }
    case 'pushTest': {
      S.busy = true; S.err = null; S.admPushRes = 'Enviando…'; render();
      const ok = await pushSync(true); const r = ok ? await avisar('prueba', null, { uid }) : { error: 'Las notificaciones no están activas en este celular.' };
      S.busy = false; S.admPushRes = !r ? 'Falta configurar el servidor de avisos.' : r.error ? 'Error: ' + r.error : r.omitido ? 'Espera un minuto para enviar otra prueba.' : (r.enviados || []).includes('ok') ? 'Prueba enviada. Debe llegarte en unos segundos; si tienes la app abierta, sale solo en la barra de notificaciones.' : 'El servidor respondió: ' + JSON.stringify(r);
      render(); if (S.screen === 'admin') loadAdmPush(); break;
    }
    case 'toggleSnd': if (soundOn()) lsSet('jnfm_sonido', '0'); else { lsSet('jnfm_sonido', '1'); beepUnlock(); sound('ok'); } render(); break;
    case 'closeErr': S.err = null; render(); break;
    case 'togglePass': { const pos = (document.getElementById('pw') || {}).selectionStart; S.showPass = !S.showPass; render(); const p = document.getElementById('pw'); if (p) { p.focus(); try { p.setSelectionRange(pos, pos); } catch (e) { } } break; }
    case 'toggleCrear': S.f.modoCrear = !S.f.modoCrear; S.err = null; render(); break;
    case 'google': S.busy = true; S.err = null; render(); try { await signInWithPopup(auth, new GoogleAuthProvider()); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'signin': case 'signup': {
      const em = (S.f.email || '').trim(), pw = S.f.pass || '';
      if (!em || !pw) { S.err = 'Escribe tu correo y tu contraseña.'; render(); break; }
      S.busy = true; S.err = null; render();
      try { if (a === 'signup') await createUserWithEmailAndPassword(auth, em, pw); else await signInWithEmailAndPassword(auth, em, pw); S.busy = false; render(); S.f.pass = ''; }
      catch (e) {
        if (a === 'signup' && e && e.code === 'auth/email-already-in-use') {
          // La cuenta ya existía (por ejemplo, se creó en un intento anterior): se intenta ingresar con esa misma contraseña
          try { await signInWithEmailAndPassword(auth, em, pw); S.busy = false; S.f.pass = ''; S.f.modoCrear = false; render(); break; }
          catch (e2) { S.busy = false; S.f.modoCrear = false; S.err = 'Ya existe una cuenta con ese correo, pero la contraseña no coincide. Escribe la contraseña con la que la creaste y toca "Ingresar", toca "Olvidé mi contraseña" o, si la creaste con Google, usa "Entrar con Google".'; render(); break; }
        }
        fail(e);
      }
      break;
    }
    case 'reset': {
      const em = (S.f.email || '').trim(); if (!em) { S.err = 'Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".'; render(); break; }
      try { await sendPasswordResetEmail(auth, em); S.banner = { kind: 'ok', text: 'Te enviamos un correo para restablecer la contraseña.' }; S.err = null; render(); } catch (e) { fail(e); }
      break;
    }
    case 'saveProfile': {
      const nom = (S.f.nombre || '').trim(), tel = String(S.f.telefono || '').replace(/\D/g, '');
      if (nom.length < 2) { S.err = 'Escribe tu nombre.'; render(); break; }
      if (tel.length !== 10) { S.err = 'El celular debe tener 10 dígitos.'; render(); break; }
      if (!S.f.acepta) { S.err = 'Debes autorizar el tratamiento de datos para usar la app.'; render(); break; }
      S.busy = true; render();
      try { await setDoc(doc(db, 'usuarios', uid), { nombre: nom, telefono: tel, aceptoDatos: true, aceptoEn: serverTimestamp(), creado: serverTimestamp(), contactos: [] }); S.busy = false; afterLogin(S.user); } catch (e) { fail(e); }
      break;
    }
    case 'logout': S.online = false; await pushOffline(); await stopWatch(); await signOut(auth); break;
    case 'retryGps': S.gps = S.pos ? 'ok' : 'pendiente'; S.gpsErr = null; render(); getGps(); if (S.screen === 'solicitudes' && S.online) { stopWatch(); startWatch(); } break;
    case 'pickDest': S.pickDest = !S.pickDest; S.err = null; render(); if (S.pickDest) { const m = document.getElementById('map'); if (m) m.scrollIntoView({ block: 'center' }); } break;
    case 'clearDest': S.destPin = null; S.route = null; render(); break;
    case 'geoDest': {
      const q = (S.f.destino || '').trim();
      if (q.length < 3) { S.err = 'Escribe primero el destino y luego toca "Ubicar en el mapa".'; render(); break; }
      S.busy = true; S.err = null; render();
      try { const p = await geocodeDestino(q); S.busy = false; if (p) { S.destPin = p; S.route = null; render(); } else { S.err = 'No encontramos esa dirección en el mapa. Toca "Marcar en el mapa" y señala el punto.'; render(); } }
      catch (e) { S.busy = false; S.err = 'No se pudo buscar la dirección. Toca "Marcar en el mapa" y señala el punto.'; render(); }
      break;
    }
    case 'minus': S.offer = Math.max(MIN, S.offer - 500); render(); break;
    case 'plus': S.offer += 500; render(); break;
    case 'otroToggle': S.otroOpen = !S.otroOpen; S.f.otroErr = ''; render(); break;
    case 'otroUse': { const n = parseMoney(S.f.otroVal), er = validAmount(n); if (er) { S.f.otroErr = er; render(); break; } S.offer = n; S.otroOpen = false; S.f.otroVal = ''; S.f.otroErr = ''; render(); break; }
    case 'notaToggle': S.notaOpen = !S.notaOpen; render(); break;
    case 'tipoSrv': S.tipo = v === 'envio' ? 'envio' : 'viaje'; S.err = null; render(); break;
    case 'envCont': S.f.envCont = v; render(); break;
    case 'pagaRecibe': S.pagaRecibe = v === '1'; render(); break;
    case 'pago': S.pago = v === 'transferencia' ? 'transferencia' : 'efectivo'; render(); break;
    case 'buscar': {
      if (blockOf(uid, 'pasajero')) { S.err = 'Tu cuenta tiene una restricción temporal por cancelaciones.'; render(); break; }
      const dest = (S.f.destino || '').trim(), refTxt = (S.f.ref || '').trim(), env = S.tipo === 'envio';
      const verErr = m => { S.err = m; render(); const el = document.querySelector('[role=alert]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); };
      if (dest.length < 2) { verErr(env ? 'Escribe a dónde llevamos el envío.' : 'Escribe o elige el destino del viaje.'); break; }
      const recNom = String(S.f.recNom || '').trim().replace(/\s+/g, ' '), recTel = cleanTel(S.f.recTel);
      if (env) {
        if (!S.f.envCont) { verErr('Elige qué envías.'); break; }
        if (recNom.length < 2) { verErr('Escribe el nombre de quien recibe.'); break; }
        if (recTel.length !== 10) { verErr('El celular de quien recibe debe tener 10 dígitos.'); break; }
        if (!S.f.envOk) { verErr('Confirma la declaración sobre el contenido del envío.'); break; }
      }
      S.busy = true; S.err = null; S.banner = null; render();
      if (!S.pos) await gpsOnce(8000);
      if (!S.pos && refTxt.length < 3) { S.busy = false; S.err = 'No pudimos obtener tu ubicación GPS. Escribe una referencia del punto de recogida.'; render(); break; }
      try {
        const data = { pasajeroId: uid, pasajeroNombre: S.perfil.nombre, origen: { texto: refTxt || 'Ubicación GPS', lat: S.pos ? S.pos.lat : null, lng: S.pos ? S.pos.lng : null }, destino: S.destPin ? { texto: dest, lat: S.destPin.lat, lng: S.destPin.lng } : { texto: dest }, oferta: S.offer, nota: S.notaOpen ? (S.f.nota || '').trim().slice(0, 200) : '', pago: S.pago, estado: 'buscando', creado: serverTimestamp(), conductorId: null, precioFinal: null, conductor: null };
        if (env) { data.tipo = 'envio'; data.envio = { contenido: S.f.envCont, desc: String(S.f.envDesc || '').trim().slice(0, 120), pagaRecibe: !!S.pagaRecibe }; }
        const r = await addDoc(collection(db, 'viajes'), data);
        const cod = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
        const bt = writeBatch(db);
        bt.set(doc(db, 'viajes', r.id, 'privado', uid), { telefono: S.perfil.telefono, nombre: S.perfil.nombre });
        if (env) { bt.set(doc(db, 'viajes', r.id, 'entrega', 'recibe'), { nombre: recNom.slice(0, 60), telefono: recTel }); bt.set(doc(db, 'viajes', r.id, 'entrega', 'codigo'), { c: cod }); }
        try { await bt.commit(); } catch (e) { if (env) await updateDoc(doc(db, 'viajes', r.id), { estado: 'cancelado', canceladoEn: serverTimestamp(), canceladoPor: uid }).catch(() => { }); throw e; }
        S.envCod = env ? cod : null; S.recibe = env ? { nombre: recNom, telefono: recTel } : null;
        S.viajeId = r.id; S.viaje = Object.assign({ id: r.id }, data); S.ofertas = []; S.busy = false; sound('ok'); avisarSolicitud(r.id); pushSync(true); go('buscando');
      } catch (e) { fail(e); }
      break;
    }
    case 'cancelTrip':
      S.busy = true; render();
      try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'cancelado', canceladoEn: serverTimestamp(), canceladoPor: uid }); S.busy = false; render(); } catch (e) { fail(e); }
      break;
    case 'accept':
      S.busy = true; render();
      try {
        await runTransaction(db, async tx => {
          const vref = doc(db, 'viajes', S.viajeId), oref = doc(db, 'viajes', S.viajeId, 'ofertas', v);
          const vs = await tx.get(vref), os = await tx.get(oref);
          if (!vs.exists() || vs.data().estado !== 'buscando') throw new Error('Esta solicitud ya no está disponible.');
          if (!os.exists()) throw new Error('El conductor retiró su oferta. Elige otra.');
          const o = os.data(), e = offerEta(Object.assign({ id: v }, o));
          tx.update(vref, { estado: 'asignado', conductorId: v, precioFinal: o.precio, conductor: { nombre: o.nombre, moto: o.moto, color: o.color, placa: o.placa }, asignadoEn: serverTimestamp(), etaMin: e ? e.min : 5 });
        });
        avisar('asignado', S.viajeId); S.busy = false; render();
      } catch (e) { fail(e); }
      break;
    case 'sos': S.sos = S.sos === 'sent' ? 'sent' : 'confirm'; render(); break;
    case 'sosCancel': S.sos = null; render(); break;
    case 'sosSend':
      try { await addDoc(collection(db, 'alertas'), { viajeId: S.viajeId, creadoPor: uid, nombre: S.perfil.nombre, rol: S.screen === 'cviaje' ? 'conductor' : 'pasajero', lat: S.pos ? S.pos.lat : null, lng: S.pos ? S.pos.lng : null, estado: 'activa', creado: serverTimestamp() }); S.sos = 'sent'; try { if (navigator.vibrate) navigator.vibrate([80]); } catch (e) { } render(); } catch (e) { fail(e); }
      break;
    case 'rate': S.rating = +v; render(); break;
    case 'chip': S.chips[v] = !S.chips[v]; render(); break;
    case 'sendRating':
      S.busy = true; render();
      try { await setDoc(doc(db, 'conductores', S.viaje.conductorId, 'calificaciones', S.viaje.id), { estrellas: S.rating, aspectos: Object.keys(S.chips).filter(k => S.chips[k]), comentario: (S.f.comentario || '').trim().slice(0, 500), creado: serverTimestamp() }); S.busy = false; delete S.ratings[S.viaje.conductorId]; sound('ok'); S.banner = { kind: 'ok', text: 'Calificación enviada. Gracias por viajar con Motocaimán.' }; endPassengerTrip(); } catch (e) { fail(e); }
      break;
    case 'skipRating': endPassengerTrip(); break;
    case 'closeMenu': go(S.mode === 'conductor' ? 'solicitudes' : 'home'); break;
    case 'modeP': S.mode = 'pasajero'; S.online = false; stopWatch(); pushSync(false); go('home'); break;
    case 'modeC': S.mode = 'conductor'; go('solicitudes'); break;
    case 'addContact': {
      const nom = (S.f.cNombre || '').trim(), tel = String(S.f.cTel || '').replace(/\D/g, '');
      if (nom.length < 2) { S.f.cErr = 'Escribe el nombre del contacto.'; render(); break; }
      if (tel.length !== 10) { S.f.cErr = 'El celular debe tener 10 dígitos.'; render(); break; }
      const cs = (S.perfil.contactos || []).concat([{ nombre: nom, telefono: tel }]);
      S.busy = true; render();
      try { await updateDoc(doc(db, 'usuarios', uid), { contactos: cs }); S.perfil.contactos = cs; S.f.cNombre = ''; S.f.cTel = ''; S.f.cErr = ''; S.busy = false; render(); } catch (e) { fail(e); }
      break;
    }
    case 'saveTransfer': {
      const t = (S.f.transferencia || '').trim().slice(0, 80);
      if (t.length < 5) { S.err = 'Escribe la entidad y el número, por ejemplo: Nequi 300 123 4567.'; render(); break; }
      S.busy = true; render();
      try { await updateDoc(doc(db, 'usuarios', uid), { transferencia: t }); S.perfil.transferencia = t; S.busy = false; S.banner = { kind: 'ok', text: 'Datos guardados.' }; go('menu'); } catch (e) { fail(e); }
      break;
    }
    case 'delContact': {
      const cs = (S.perfil.contactos || []).filter((c, i) => i !== +v);
      try { await updateDoc(doc(db, 'usuarios', uid), { contactos: cs }); S.perfil.contactos = cs; render(); } catch (e) { fail(e); }
      break;
    }
    case 'idTipo': S.f.idTipo = v; S.err = null; render(); break;
    case 'saveCpriv': {
      const dir = String(S.f.drvDir || '').trim().replace(/\s+/g, ' '), tel = cleanTel(S.f.drvTel);
      if (!validDir(dir)) { S.err = 'Escribe tu dirección de residencia (mínimo 5 caracteres).'; render(); break; }
      if (tel.length !== 10) { S.err = 'El celular debe tener 10 dígitos.'; render(); break; }
      const c0 = S.conductor || {}, cp = S.cpriv || {}, faltaId = !c0.idTipo || !cp.idNumero;
      const puedeTipo = !c0.idTipo || c0.estado !== 'aprobado', idT = (puedeTipo && S.f.idTipo) || c0.idTipo || '', idN = cp.idNumero || cleanId(S.f.idNum);
      if (faltaId) { const er = idErr(idT, idN); if (er) { S.err = er; render(); break; } }
      S.busy = true; render();
      try {
        const pd = { direccion: dir, telefono: tel, actualizado: serverTimestamp() }; if (idN) pd.idNumero = idN;
        const bt = writeBatch(db); bt.set(privRef(uid), pd);
        if (idT && idT !== c0.idTipo) bt.update(doc(db, 'conductores', uid), { idTipo: idT });
        await bt.commit();
        if (idT && idT !== c0.idTipo) S.conductor = Object.assign({}, S.conductor, { idTipo: idT });
        S.cpriv = { direccion: dir, telefono: tel, idNumero: idN || undefined }; S.idFalta = null; S.busy = false; S.banner = { kind: 'ok', text: faltaId ? 'Datos guardados.' : 'Datos de contacto guardados.' }; render();
      } catch (e) { fail(e); }
      break;
    }
    case 'saveConductor': {
      const moto = (S.f.moto || '').trim(), color = (S.f.color || '').trim(), placa = (S.f.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (moto.length < 2) { S.err = 'Escribe la marca y el modelo del mototour.'; render(); break; }
      if (color.length < 2) { S.err = 'Escribe el color del mototour.'; render(); break; }
      if (!/^[A-Z0-9]{5,7}$/.test(placa) || !/[A-Z]/.test(placa) || !/[0-9]/.test(placa)) { S.err = 'La placa debe tener entre 5 y 7 letras y números, por ejemplo ABC12D.'; render(); break; }
      const registro = String(S.f.registro || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (registro.length < 2 || registro.length > 30) { S.err = 'Escribe el número de registro de tránsito tal como aparece en el certificado.'; render(); break; }
      const dir = String(S.f.drvDir || '').trim().replace(/\s+/g, ' '), tel = cleanTel(S.f.drvTel);
      if (!validDir(dir)) { S.err = 'Escribe tu dirección de residencia (mínimo 5 caracteres).'; render(); break; }
      if (tel.length !== 10) { S.err = 'El celular debe tener 10 dígitos.'; render(); break; }
      const idT = S.f.idTipo || '', idN = cleanId(S.f.idNum), idE = idErr(idT, idN);
      if (idE) { S.err = idE; render(); window.scrollTo(0, 0); break; }
      const refC = String(S.f.drvRef || '').toUpperCase().replace(/\s+/g, '');
      if (refC) {
        if (!/^JNF-[A-Z0-9]{5,7}$/.test(refC)) { S.err = 'El código de referido tiene la forma JNF-placa, por ejemplo JNF-ABC12D.'; render(); break; }
        if (refC === 'JNF-' + placa) { S.err = 'No puedes usar tu propio código de referido.'; render(); break; }
        try { const rq = await getDocs(query(collection(db, 'conductores'), where('placa', '==', refC.slice(4)), limit(1))); if (rq.empty) { S.err = 'No encontramos un conductor con el código ' + refC + '. Revísalo o déjalo vacío.'; render(); break; } } catch (e) { }
      }
      const REQ = docsReq(idT), subir = REQ.filter(d => S.docs[d[0]] && S.docs[d[0]].estado === 'local'), faltan = REQ.length - REQ.filter(d => S.docs[d[0]]).length;
      S.busy = true; S.docMsg = 'Enviando registro…'; render();
      try {
        if (!S.conductor) { const cd = { nombre: S.perfil.nombre, moto, color, placa, registro, idTipo: idT, estado: 'pendiente', creado: serverTimestamp() }; if (refC) cd.refCodigo = refC; await setDoc(doc(db, 'conductores', uid), cd); }
        await setDoc(privRef(uid), { direccion: dir, telefono: tel, idNumero: idN, actualizado: serverTimestamp() });
        let n = 0;
        for (const d of subir) {
          n++; S.docMsg = 'Subiendo documentos (' + n + ' de ' + subir.length + ')…'; render();
          await setDoc(doc(db, 'conductores', uid, 'documentos', d[0]), { tipo: d[0], img: S.docs[d[0]].img, subido: serverTimestamp() }); S.docs[d[0]].estado = 'subido';
        }
        S.docMsg = ''; S.busy = false; S.cpriv = { direccion: dir, telefono: tel, idNumero: idN }; S.docsFor = uid; sound('ok'); avisar('registro', null, { conductorId: uid });
        S.banner = { kind: 'info', text: 'Registro enviado. ' + (faltan ? 'Te faltan ' + faltan + ' documento(s); puedes subirlos después desde "Mis documentos". ' : '') + 'El administrador revisará y activará tu cuenta.' }; go('menu');
      } catch (e) { S.docMsg = ''; fail(e); }
      break;
    }
    case 'online':
      if (!S.online && blockOf(uid, 'conductor')) { S.err = 'Tu modo conductor está pausado por cancelaciones.'; render(); break; }
      if (!S.online && conductorBloqueado()) { S.err = 'Tu suscripción está vencida. Cuando el administrador registre tu pago podrás conectarte.'; render(); break; }
      S.online = !S.online;
      if (S.online) { beepUnlock(); sound('ok'); pushSync(true); go('solicitudes'); } else { S.requests = []; stopWatch(); pushSync(false); go('solicitudes'); }
      break;
    case 'envios': {
      const nv = !(S.conductor && S.conductor.envios);
      S.busy = true; render();
      try { await updateDoc(doc(db, 'conductores', uid), { envios: nv }); S.conductor = Object.assign({}, S.conductor, { envios: nv }); S.busy = false; S._pushKey = null; pushSync(false); S.banner = { kind: 'ok', text: nv ? 'Ahora recibes también solicitudes de envío.' : 'Ya no recibes solicitudes de envío.' }; go('solicitudes'); } catch (e) { fail(e); }
      break;
    }
    case 'reqMap': S.reqMap = S.reqMap === v ? null : v; render(); break;
    case 'cIgnore': S.ignored[v] = true; S.requests = S.requests.filter(r => r.id !== v); render(); break;
    case 'cOtroToggle': { const cur = S.cOtro[v] || {}; S.cOtro[v] = { open: !cur.open, val: cur.val || '', err: '' }; render(); break; }
    case 'cOffer': case 'cOtroSend': {
      const r = S.requests.find(x => x.id === v); if (!r) break;
      let price = +(b.getAttribute('data-p') || 0);
      if (a === 'cOtroSend') { const o = S.cOtro[v] || {}; const n = parseMoney(o.val), er = validAmount(n); if (er) { S.cOtro[v] = { open: true, val: o.val, err: er }; render(); break; } price = n; }
      S.busy = true; render();
      try {
        const of = { conductorId: uid, nombre: S.conductor.nombre, moto: S.conductor.moto, color: S.conductor.color, placa: S.conductor.placa, precio: price, creado: serverTimestamp(), lat: S.pos ? S.pos.lat : null, lng: S.pos ? S.pos.lng : null };
        if (S.conductor.registro) of.registro = S.conductor.registro;
        await setDoc(doc(db, 'viajes', v, 'ofertas', uid), of);
        S.busy = false; sound('ok'); avisar('oferta', v, { conductorId: uid }); S.espera = { viajeId: v, nombre: r.pasajeroNombre, precio: price, origen: r.origen.texto, destino: r.destino.texto, pago: r.pago }; go('espera');
      } catch (e) { fail(e); }
      break;
    }
    case 'cWithdraw':
      try { await deleteDoc(doc(db, 'viajes', S.espera.viajeId, 'ofertas', uid)); } catch (e) { }
      S.espera = null; go('solicitudes'); break;
    case 'backToRequests': S.espera = null; go('solicitudes'); break;
    case 'llegue': S.busy = true; render(); try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'en_punto', enPuntoEn: serverTimestamp() }); avisar('en_punto', S.viajeId); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'openCancel': S.cancel = { motivo: null }; S.f.motivoTexto = ''; S.cancelRol = S.screen === 'cviaje' ? 'conductor' : 'pasajero'; S.cancelBack = S.screen; go('cancelar'); break;
    case 'backFromCancel': go(S.cancelBack || (S.cancelRol === 'conductor' ? 'cviaje' : 'viaje')); break;
    case 'motivo': S.cancel.motivo = v; S.err = null; render(); if (v === 'otro') { const t = document.getElementById('mt'); if (t) t.focus(); } break;
    case 'doCancel': {
      const m = S.cancel.motivo, txt = (S.f.motivoTexto || '').trim();
      if (!m) { S.err = 'Elige el motivo de la cancelación.'; render(); break; }
      if (m === 'otro' && txt.length < 5) { S.err = 'Escribe el motivo de la cancelación (mínimo 5 caracteres).'; render(); const t = document.getElementById('mt'); if (t) t.focus(); break; }
      const v0 = S.viaje, rol = S.cancelRol, pen = rol === 'pasajero' ? penPasajero(v0, m) : (m === 'inseguro' ? null : 'conductor');
      S.busy = true; render();
      try {
        await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'cancelado', canceladoEn: serverTimestamp(), canceladoPor: uid, motivo: m, motivoTexto: m === 'otro' ? txt.slice(0, 200) : '', penalizaA: pen });
        avisar('cancelado', S.viajeId);
        if (m === 'inseguro') addDoc(collection(db, 'alertas'), { viajeId: v0.id, creadoPor: uid, nombre: S.perfil.nombre, rol: rol + ' (canceló: se siente inseguro)', lat: S.pos ? S.pos.lat : null, lng: S.pos ? S.pos.lng : null, estado: 'activa', creado: serverTimestamp() }).catch(() => { });
        S.busy = false; render();
      } catch (e) { fail(e); }
      break;
    }
    case 'noShow':
      S.busy = true; render();
      try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'cancelado', canceladoEn: serverTimestamp(), canceladoPor: uid, motivo: 'no_se_presento', motivoTexto: '', penalizaA: 'pasajero' }); avisar('cancelado', S.viajeId); S.busy = false; render(); } catch (e) { fail(e); }
      break;
    case 'cStart': S.busy = true; render(); try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'en_curso', iniciadoEn: serverTimestamp() }); if (esEnvio(S.viaje)) avisar('recogido', S.viajeId); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'cEntregar': {
      const cod = String(S.f.codEnt || '').replace(/\D/g, ''), dev = !!(S.viaje && S.viaje.devolucion);
      if (cod.length !== 4) { S.err = 'Escribe el código de 4 dígitos.'; render(); break; }
      S.busy = true; S.err = null; render();
      try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'finalizado', finalizadoEn: serverTimestamp(), codigoEntrega: cod }); S.f.codEnt = ''; avisar('entregado', S.viajeId); S.busy = false; render(); }
      catch (e) { if (e && e.code === 'permission-denied') { S.busy = false; S.err = 'El código no coincide. Pídelo de nuevo a ' + (dev ? 'quien envía' : 'quien recibe') + '.'; render(); } else fail(e); }
      break;
    }
    case 'devAsk': S.devAsk = !S.devAsk; S.f.devMotivo = ''; S.err = null; render(); break;
    case 'cDevolver': {
      const m = String(S.f.devMotivo || '').trim().replace(/\s+/g, ' ');
      if (m.length < 5) { S.err = 'Escribe por qué no pudiste entregar (mínimo 5 caracteres).'; render(); break; }
      S.busy = true; S.err = null; render();
      try { await updateDoc(doc(db, 'viajes', S.viajeId), { devolucion: true, devolucionEn: serverTimestamp(), devolucionMotivo: m.slice(0, 200) }); S.devAsk = false; S.f.codEnt = ''; avisar('devolucion', S.viajeId); S.busy = false; S.banner = { kind: 'info', text: 'Devuelve el paquete a quien envía. Para cerrar, pídele el código de entrega.' }; render(); } catch (e) { fail(e); }
      break;
    }
    case 'cFinish': S.busy = true; render(); try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'finalizado', finalizadoEn: serverTimestamp() }); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'cCancel': S.busy = true; render(); try { await updateDoc(doc(db, 'viajes', S.viajeId), { estado: 'cancelado', canceladoEn: serverTimestamp(), canceladoPor: uid }); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'cSendRating':
      S.busy = true; render();
      try { await setDoc(doc(db, 'usuarios', S.viaje.pasajeroId, 'calificaciones', S.viaje.id), { estrellas: S.rating, aspectos: Object.keys(S.chips).filter(k => S.chips[k]), creado: serverTimestamp() }); S.busy = false; sound('ok'); endDriverTrip(); } catch (e) { fail(e); }
      break;
    case 'cSkipRating': endDriverTrip(); break;
    case 'mascClose': { const m = mascOn(); if (m) { S.mascClosed[mascKey(m)] = true; lsSet(mascKey(m), '1'); } render(); break; }
    case 'mascNew':
      S.me = { id: null, src: null, img: null, colores: [], opcion: null, iv: null }; S.f.mNombre = ''; S.f.mMensaje = ''; S.f.mDesde = ''; S.f.mHasta = ''; S.mascMsg = ''; S.err = null; S.banner = null;
      S.admTab = 'mascEdit'; render(); window.scrollTo(0, 0); break;
    case 'mascEdit': {
      const m = (S.mascList || []).find(x => x.id === v); if (!m) break;
      S.me = { id: m.id, src: S.mascThumbs[m.id] || null, img: null, colores: (m.colores || []).slice(), opcion: m.opcion, iv: m.iv };
      S.f.mNombre = m.nombre || ''; S.f.mMensaje = m.mensaje || ''; S.f.mDesde = m.desde || ''; S.f.mHasta = m.hasta || ''; S.mascMsg = S.me.src ? '' : 'Cargando la imagen…'; S.err = null; S.banner = null;
      S.admTab = 'mascEdit'; render(); window.scrollTo(0, 0);
      if (!S.me.src) { try { const d = await getDoc(doc(db, 'mascaras', m.id, 'img', 'data')); if (d.exists() && S.me && S.me.id === m.id) { S.me.src = await toBlobUrl(d.data().img); } } catch (e) { S.err = errMsg(e); } if (S.me) S.mascMsg = ''; render(); }
      break;
    }
    case 'mascOpc': if (S.me) { S.me.opcion = v; render(); } break;
    case 'mascSave': {
      const E = S.me; if (!E) break;
      const nom = (S.f.mNombre || '').trim().replace(/\s+/g, ' '), msj = (S.f.mMensaje || '').trim().replace(/\s+/g, ' '), de = S.f.mDesde || '', ha = S.f.mHasta || '', activar = v === '1', hoy = ymd(new Date());
      let er = '';
      if (!E.src) er = 'Adjunta la imagen de la máscara.';
      else if (!E.opcion) er = 'Elige cómo se verá la máscara (opción A, B, C o D).';
      else if (de && ha && ha < de) er = 'La fecha final no puede ser anterior a la fecha inicial.';
      else if (ha && ha < hoy) er = 'La fecha final ya pasó. Cámbiala o déjala vacía.';
      if (er) { S.err = er; render(); window.scrollTo(0, 0); break; }
      S.busy = true; S.err = null; render();
      try {
        const id = E.id || doc(collection(db, 'mascaras')).id, now = Date.now(), nombre = nom.length >= 2 ? nom : 'Máscara ' + E.opcion + ' · ' + fmtYmd(hoy);
        const data = { nombre: nombre.slice(0, 40), mensaje: msj.slice(0, 90), opcion: E.opcion, colores: (E.colores || []).slice(0, 4), desde: de, hasta: ha, estado: activar ? 'activa' : (de ? 'programada' : 'guardada'), ver: now, iv: E.img ? now : (E.iv || now), actualizado: serverTimestamp() };
        const bt = writeBatch(db);
        if (activar) (S.mascList || []).forEach(m => { if (m.id !== id && m.estado === 'activa') bt.update(doc(db, 'mascaras', m.id), { estado: 'guardada' }); });
        bt.set(doc(db, 'mascaras', id), data);
        if (E.img) bt.set(doc(db, 'mascaras', id, 'img', 'data'), { img: E.img });
        await bt.commit();
        if (E.img) { S.mascThumbs[id] = E.src; S.mascThumbs[id + ':iv'] = data.iv; }
        S.busy = false; S.me = null; S.admTab = 'mascaras';
        const txt = activar ? (de && de > hoy ? 'Máscara guardada y activa. Se verá desde el ' + fmtYmd(de) + '.' : 'Máscara guardada y activa.') : data.estado === 'programada' ? 'Máscara programada ' + fechasTxt(data) + '.' : 'Máscara guardada sin activar.';
        S.banner = { kind: 'ok', text: txt }; render(); window.scrollTo(0, 0);
        await loadMascAdmin(); mascAviso(id); loadMasc();
      } catch (e) { fail(e); }
      break;
    }
    case 'mascOnAct': {
      const m = (S.mascList || []).find(x => x.id === v); if (!m) break;
      if (m.hasta && m.hasta < ymd(new Date())) { S.err = 'La fecha final de esta máscara ya pasó. Toca "Editar" para cambiarla.'; render(); break; }
      S.busy = true; render();
      try {
        const bt = writeBatch(db);
        (S.mascList || []).forEach(x => { if (x.id !== v && x.estado === 'activa') bt.update(doc(db, 'mascaras', x.id), { estado: 'guardada' }); });
        bt.update(doc(db, 'mascaras', v), { estado: 'activa', actualizado: serverTimestamp() });
        await bt.commit(); S.busy = false; S.banner = { kind: 'ok', text: '"' + m.nombre + '" quedó activa.' }; render();
        await loadMascAdmin(); mascAviso(v); loadMasc();
      } catch (e) { fail(e); }
      break;
    }
    case 'mascOff':
      S.busy = true; render();
      try { await updateDoc(doc(db, 'mascaras', v), { estado: 'guardada', actualizado: serverTimestamp() }); S.busy = false; S.banner = { kind: 'ok', text: 'Máscara desactivada. La app se ve sin máscara (salvo que haya una programada en sus fechas).' }; render(); await loadMascAdmin(); loadMasc(); } catch (e) { fail(e); }
      break;
    case 'mascDel': S.mascDel = v || null; render(); break;
    case 'mascDelOk':
      S.busy = true; render();
      try {
        const bt = writeBatch(db); bt.delete(doc(db, 'mascaras', v, 'img', 'data')); bt.delete(doc(db, 'mascaras', v)); await bt.commit();
        S.busy = false; S.mascDel = null; delete S.mascThumbs[v]; S.banner = { kind: 'ok', text: 'Máscara eliminada.' }; render(); await loadMascAdmin(); loadMasc();
      } catch (e) { fail(e); }
      break;
    case 'admTab': S.admTab = v; S.err = null; if (v === 'usuarios') S.admAllUsers = null; S.mascDel = null; S.admPushRes = ''; if (v === 'notificaciones') S.f.admPushUrl = S.pushUrl; render(); if (v === 'usuarios' && !S.admUsers) loadAdmUsers(); if (v === 'mascaras') loadMascAdmin(); if (v === 'viajes' && S.admV === null) loadAdmViajes(); if (v === 'conductores') loadAdmRates(); if (v === 'notificaciones') loadAdmPush(); if (v === 'suscripciones') { loadSus(); loadPagosMes(); } if (v === 'ingresos') { if (!S.susMap) loadSus(); loadIngresos(); } if (v === 'tarifas') { const T = tarifas(); ['semanal', 'quincenal', 'mensual', 'diasGratis', 'diasGracia', 'refValor', 'refTipo', 'instrucciones'].forEach(k => { S.f['t_' + k] = String(T[k]); }); render(); } break;
    case 'admF': { const i = v.indexOf('='); S.f[v.slice(0, i)] = v.slice(i + 1); S.admVPage = 20; render(); break; }
    case 'admVLoad': loadAdmViajes(); break;
    case 'admVMore': S.admVPage += 20; render(); break;
    case 'admVWho': { const i = v.indexOf('|'); S.f.admVRol = v.slice(0, i); S.f.admVQ = v.slice(i + 1); S.admVPage = 20; render(); window.scrollTo(0, 0); break; }
    case 'admRates':
      if (S.admRateOpen === v) { S.admRateOpen = null; render(); break; }
      S.admRateOpen = v; render();
      if (!S.admRateList[v]) { try { const qs = await getDocs(query(collection(db, 'conductores', v, 'calificaciones'), orderBy('creado', 'desc'), limit(10))); S.admRateList[v] = qs.docs.map(d => d.data()); } catch (e) { S.admRateList[v] = []; S.err = errMsg(e); } render(); }
      break;
    case 'admPushSave': {
      const u = String(S.f.admPushUrl || '').trim().replace(/\/+$/, '');
      if (u && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(u)) { S.err = 'La dirección debe empezar por https:// (por ejemplo https://jnf-moto-avisos.tu-cuenta.workers.dev).'; render(); break; }
      S.busy = true; S.err = null; render();
      try { await setDoc(doc(db, 'config', 'app'), { pushUrl: u, actualizado: serverTimestamp() }); S.pushUrl = u; S.f.admPushUrl = u; S.busy = false; S.admPushRes = u ? 'Guardado. Toca "Probar servidor".' : 'Se quitó la dirección: las notificaciones quedan apagadas.'; render(); } catch (e) { fail(e); }
      break;
    }
    case 'admPushCheck': {
      const u = String(S.f.admPushUrl || S.pushUrl || '').trim().replace(/\/+$/, ''); if (!u) { S.err = 'Escribe la dirección del servidor.'; render(); break; }
      S.busy = true; S.err = null; S.admPushRes = 'Probando…'; render();
      try { const r = await fetch(u + '/'); const j = await r.json(); S.admPushRes = j.estado === 'activo' ? (j.clave === 'configurada' ? 'El servidor responde y está configurado.' : 'El servidor responde, pero falta la variable VAPID_PUBLIC.') : 'Respuesta inesperada: ' + JSON.stringify(j); }
      catch (e) { S.admPushRes = 'No se pudo conectar con el servidor. Revisa la dirección.'; }
      S.busy = false; render(); break;
    }
    case 'susFicha': {
      const s = S.susMap && S.susMap[v]; if (!s) break;
      S.susId = v; S.admTab = 'susFicha'; S.err = null; S.banner = null; S.anularId = null;
      S.f.pagFecha = ymd(new Date()); S.f.pagDesde = ''; S.f.pagMedio = 'Efectivo'; S.f.pagOtro = ''; S.f.pagMotivo = ''; S.f.susIni = s.inicio;
      const rc = s.referidoPor && (S.adm.conductores || []).find(x => x.id === s.referidoPor); S.f.susRefCod = rc ? codigoDe(rc) : ((S.adm.conductores || []).find(x => x.id === v) || {}).refCodigo || '';
      render(); window.scrollTo(0, 0); loadSusPagos(v);
      if (!S.admPriv[v]) getDoc(privRef(v)).then(p => { S.admPriv[v] = p.exists() ? p.data() : {}; if (S.admTab === 'susFicha') render(); }).catch(() => { });
      break;
    }
    case 'susPlan': {
      const s = S.susMap[S.susId]; if (!s || s.plan === v) break;
      S.busy = true; render();
      try { await updateDoc(doc(db, 'suscripciones', s.id), { plan: v }); s.plan = v; S.busy = false; S.banner = { kind: 'ok', text: 'Plan cambiado a ' + planTxt(v).toLowerCase() + '. Aplica desde el próximo pago.' }; render(); } catch (e) { fail(e); }
      break;
    }
    case 'susIniSave': {
      const s = S.susMap[S.susId], ini = S.f.susIni; if (!s) break;
      if (s.nPagos) { S.err = 'Ya tiene pagos registrados; la fecha de inscripción no se puede cambiar.'; render(); break; }
      if (!fromYmd(ini) || ini > ymd(new Date())) { S.err = 'Escribe una fecha de inscripción válida (no puede ser futura).'; render(); break; }
      const T = tarifas(), ph = addDays(ini, T.diasGratis), d = { inicio: ini, pagadoHasta: ph, venceGracia: venceGraciaDe(ph, T) };
      S.busy = true; render();
      try { await updateDoc(doc(db, 'suscripciones', s.id), d); Object.assign(s, d); S.busy = false; S.banner = { kind: 'ok', text: 'Fecha de inscripción cambiada. Mes gratis hasta el ' + fmtYmd(ph) + '.' }; render(); } catch (e) { fail(e); }
      break;
    }
    case 'susRefSave': {
      const s = S.susMap[S.susId]; if (!s) break;
      const cod = String(S.f.susRefCod || '').toUpperCase().replace(/\s+/g, '');
      if (s.refAcreditado) { S.err = 'El descuento de este referido ya se acreditó; no se puede cambiar.'; render(); break; }
      let ref = null;
      if (cod) { const r = (S.adm.conductores || []).find(x => codigoDe(x) === cod); if (!r) { S.err = 'No hay un conductor con el código ' + cod + '.'; render(); break; } if (r.id === s.id) { S.err = 'Un conductor no puede referirse a sí mismo.'; render(); break; } ref = r.id; }
      S.busy = true; render();
      try { await updateDoc(doc(db, 'suscripciones', s.id), { referidoPor: ref }); s.referidoPor = ref; S.busy = false; S.banner = { kind: 'ok', text: ref ? 'Referido guardado.' : 'Se quitó el referido.' }; render(); } catch (e) { fail(e); }
      break;
    }
    case 'pagSave': {
      const s = S.susMap[S.susId]; if (!s) break;
      const T = tarifas(), val = T[s.plan] || 0, dr = descRef(s, val), otro = Math.max(0, parseMoney(S.f.pagOtro) || 0), fecha = S.f.pagFecha, medio = S.f.pagMedio;
      if (!fromYmd(fecha) || fecha > ymd(new Date())) { S.err = 'Escribe la fecha del pago (no puede ser futura).'; render(); break; }
      if (!MEDIOS.includes(medio)) { S.err = 'Elige el medio de pago.'; render(); break; }
      if (otro > val - dr) { S.err = 'El otro descuento no puede ser mayor que el valor a pagar (' + money(val - dr) + ').'; render(); break; }
      const desde = s.pagadoHasta < fecha && S.f.pagDesde === 'hoy' ? fecha : s.pagadoHasta, hasta = finPeriodo(desde, s.plan), neto = val - dr - otro, primero = !s.nPagos;
      const R = primero && s.referidoPor && !s.refAcreditado ? S.susMap[s.referidoPor] : null;
      const upd = { pagadoHasta: hasta, venceGracia: venceGraciaDe(hasta, T), nPagos: (s.nPagos || 0) + 1, refPend: [], refAplic: (s.refAplic || []).concat(s.refPend || []) };
      if (R) upd.refAcreditado = true;
      S.busy = true; render();
      try {
        const recibo = await guardarPago({ tipo: 'suscripcion', cid: s.id, nombre: s.nombre, placa: s.placa, plan: s.plan, fecha, desde, hasta, valor: val, descRef: dr, descOtro: otro, motivo: otro ? String(S.f.pagMotivo || '').trim().slice(0, 80) : '', neto, medio, pagadoHastaAntes: s.pagadoHasta, refIds: (s.refPend || []).slice(), acreditoA: R ? R.id : null },
          tx => { tx.update(doc(db, 'suscripciones', s.id), upd); if (R) tx.update(doc(db, 'suscripciones', R.id), { refPend: (R.refPend || []).concat([s.id]) }); });
        Object.assign(s, upd); if (R) R.refPend = (R.refPend || []).concat([s.id]);
        S.busy = false; S.f.pagOtro = ''; S.f.pagMotivo = ''; S.banner = { kind: 'ok', text: 'Pago registrado · recibo ' + recibo + ' · ' + money(neto) + '. Próximo pago: ' + fmtYmd(hasta) + '.' + (R ? ' ' + R.nombre + ' recibirá su descuento por referido en su siguiente pago.' : '') };
        render(); window.scrollTo(0, 0); loadSusPagos(s.id); loadPagosMes();
      } catch (e) { fail(e); }
      break;
    }
    case 'pagAnularAsk': S.anularId = v || null; S.f.anMotivo = ''; render(); break;
    case 'pagAnular': {
      const P = S.susPagos || [], pg = P.find(x => x.id === S.anularId), s = pg && S.susMap[pg.cid]; if (!pg || !s) break;
      if (P.find(x => !x.anulado) !== pg) { S.err = 'Solo se puede anular el último pago del conductor.'; render(); break; }
      const mot = String(S.f.anMotivo || '').trim(); if (mot.length < 3) { S.err = 'Escribe el motivo de la anulación.'; render(); break; }
      const T = tarifas(), prev = pg.pagadoHastaAntes || pg.desde, n = Math.max(0, (s.nPagos || 0) - 1), ids = pg.refIds || [];
      const upd = { pagadoHasta: prev, venceGracia: venceGraciaDe(prev, T), nPagos: n };
      let aviso = '';
      if (ids.length) { upd.refPend = (s.refPend || []).concat(ids.filter(x => !(s.refPend || []).includes(x))); upd.refAplic = (s.refAplic || []).filter(x => !ids.includes(x)); }
      else if (pg.descRef && pg.refIds === undefined) aviso = ' Este pago tenía descuento por referido registrado antes de esta versión: revisa a mano si el conductor debe recuperarlo.';
      const rid = pg.acreditoA !== undefined ? pg.acreditoA : (n === 0 && s.refAcreditado ? s.referidoPor : null), R = rid ? S.susMap[rid] : null;
      let updR = null;
      if (R) { if ((R.refPend || []).includes(s.id)) { updR = { refPend: R.refPend.filter(x => x !== s.id) }; upd.refAcreditado = false; } else aviso += ' ' + R.nombre + ' ya usó el descuento que le generó este pago; no se puede revertir.'; }
      S.busy = true; render();
      try {
        const bt = writeBatch(db);
        bt.update(doc(db, 'pagos', pg.id), { anulado: true, anuladoEn: serverTimestamp(), motivoAnulacion: mot.slice(0, 80) });
        bt.update(doc(db, 'suscripciones', s.id), upd);
        if (updR) bt.update(doc(db, 'suscripciones', R.id), updR);
        await bt.commit();
        Object.assign(s, upd); if (updR) Object.assign(R, updR); pg.anulado = true; pg.motivoAnulacion = mot;
        S.busy = false; S.anularId = null; S.banner = { kind: 'ok', text: 'Recibo ' + pg.recibo + ' anulado. Próximo pago: ' + fmtYmd(prev) + '.' + aviso }; render(); loadPagosMes();
      } catch (e) { fail(e); }
      break;
    }
    case 'tRefTipo': S.f.t_refTipo = v; render(); break;
    case 'tSave': {
      const n = k => parseMoney(S.f['t_' + k]);
      const d = { semanal: n('semanal'), quincenal: n('quincenal'), mensual: n('mensual'), diasGratis: n('diasGratis'), diasGracia: n('diasGracia'), refTipo: S.f.t_refTipo === 'pct' ? 'pct' : 'fijo', refValor: n('refValor'), instrucciones: String(S.f.t_instrucciones || '').trim().slice(0, 300) };
      if (['semanal', 'quincenal', 'mensual'].some(k => isNaN(d[k]) || d[k] < 0 || d[k] % 100)) { S.err = 'Escribe las tarifas en pesos, en múltiplos de $100.'; render(); break; }
      if (isNaN(d.diasGratis) || d.diasGratis > 365 || isNaN(d.diasGracia) || d.diasGracia > 60) { S.err = 'Revisa los días: gratis entre 0 y 365, gracia entre 0 y 60.'; render(); break; }
      if (isNaN(d.refValor) || (d.refTipo === 'pct' && d.refValor > 100)) { S.err = 'Revisa el descuento por referido (el porcentaje no puede pasar de 100).'; render(); break; }
      S.busy = true; render();
      try {
        const antes = tarifas().diasGracia;
        await setDoc(doc(db, 'config', 'tarifas'), Object.assign({ actualizado: serverTimestamp() }, d)); S.tarifas = d;
        if (antes !== d.diasGracia && S.susMap) { const L = Object.values(S.susMap); for (let i = 0; i < L.length; i += 400) { const bt = writeBatch(db); L.slice(i, i + 400).forEach(s => { s.venceGracia = venceGraciaDe(s.pagadoHasta, d); bt.update(doc(db, 'suscripciones', s.id), { venceGracia: s.venceGracia }); }); await bt.commit(); } }
        S.busy = false; S.banner = { kind: 'ok', text: 'Tarifas guardadas. Aplican a los próximos cobros.' }; S.admTab = 'suscripciones'; render(); loadSus();
      } catch (e) { fail(e); }
      break;
    }
    case 'ingRango': {
      const d = new Date(), y = d.getFullYear(), m = d.getMonth();
      const r = { mes: [new Date(y, m, 1), d], mesant: [new Date(y, m - 1, 1), new Date(y, m, 0)], anio: [new Date(y, 0, 1), d] }[v];
      S.f.ingIni = ymd(r[0]); S.f.ingFin = ymd(r[1]); loadIngresos(); break;
    }
    case 'ingLoad': loadIngresos(); break;
    case 'ingOtroToggle': S.ingOtro = !S.ingOtro; if (S.ingOtro) { S.f.oiConcepto = ''; S.f.oiValor = ''; S.f.oiFecha = ymd(new Date()); S.f.oiMedio = 'Efectivo'; } render(); break;
    case 'ingOtroSave': {
      const c = String(S.f.oiConcepto || '').trim(), val = parseMoney(S.f.oiValor), f = S.f.oiFecha;
      if (c.length < 3) { S.err = 'Escribe el concepto del ingreso.'; render(); break; }
      if (isNaN(val) || val <= 0) { S.err = 'Escribe el valor del ingreso.'; render(); break; }
      if (!fromYmd(f) || f > ymd(new Date())) { S.err = 'Escribe la fecha del ingreso (no puede ser futura).'; render(); break; }
      S.busy = true; render();
      try { const rec = await guardarPago({ tipo: 'otro', cid: null, concepto: c.slice(0, 80), fecha: f, valor: val, descRef: 0, descOtro: 0, neto: val, medio: MEDIOS.includes(S.f.oiMedio) ? S.f.oiMedio : 'Efectivo' }); S.busy = false; S.ingOtro = false; S.banner = { kind: 'ok', text: 'Ingreso registrado · recibo ' + rec + '.' }; render(); loadIngresos(); } catch (e) { fail(e); }
      break;
    }
    case 'ingCsv': {
      const L = S.ingresos || []; if (!L.length) { S.err = 'No hay ingresos para descargar en ese periodo.'; render(); break; }
      const q = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
      const filas = [['Fecha', 'Recibo', 'Tipo', 'Conductor / concepto', 'Placa', 'Plan', 'Periodo desde', 'Periodo hasta', 'Valor', 'Descuento referido', 'Otro descuento', 'Motivo', 'Neto', 'Medio', 'Estado']]
        .concat(L.map(p => [fmtYmd(p.fecha), p.recibo, p.tipo === 'otro' ? 'Otro ingreso' : 'Suscripción', p.tipo === 'otro' ? p.concepto : p.nombre, p.placa || '', p.plan ? planTxt(p.plan) : '', p.desde ? fmtYmd(p.desde) : '', p.hasta ? fmtYmd(p.hasta) : '', p.valor || 0, p.descRef || 0, p.descOtro || 0, p.motivo || '', p.anulado ? 0 : (p.neto || 0), p.medio, p.anulado ? 'Anulado' + (p.motivoAnulacion ? ': ' + p.motivoAnulacion : '') : 'Válido']));
      filas.push([], ['Total neto', '', '', '', '', '', '', '', '', '', '', '', L.filter(p => !p.anulado).reduce((a, p) => a + (p.neto || 0), 0)]);
      const csv = '﻿' + [['Asesorías y Consultorías JNF S.A.S. · NIT 901.904.435-9'], ['Ingresos Motocaimán del ' + fmtYmd(S.f.ingIni) + ' al ' + fmtYmd(S.f.ingFin)], []].concat(filas).map(f => f.map(q).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), el = document.createElement('a');
      el.href = url; el.download = 'ingresos_jnf_moto_' + S.f.ingIni + '_a_' + S.f.ingFin + '.csv'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }
    case 'admMore': S.admLimit += 30; if (fold(S.f.admUQ).trim() || S.f.admUTipo) { render(); break; } S.admUsers = null; render(); loadAdmUsers(); break;
    case 'admMake': { S.admMake = v || null; S.f.amMoto = ''; S.f.amColor = ''; S.f.amPlaca = ''; S.f.amReg = ''; S.f.amDir = ''; S.f.amOk = false; const u = (S.admUsers || []).find(x => x.id === v); S.f.amTel = u && u.telefono ? u.telefono : ''; render(); break; }
    case 'admMakeSave': {
      const u = (S.admUsers || []).find(x => x.id === v); if (!u) break;
      const moto = (S.f.amMoto || '').trim(), color = (S.f.amColor || '').trim(), placa = (S.f.amPlaca || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), reg = String(S.f.amReg || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (moto.length < 2 || color.length < 2) { S.err = 'Escribe la marca, el modelo y el color del mototour.'; render(); break; }
      if (!/^[A-Z0-9]{5,7}$/.test(placa) || !/[A-Z]/.test(placa) || !/[0-9]/.test(placa)) { S.err = 'La placa debe tener entre 5 y 7 letras y números, por ejemplo ABC12D.'; render(); break; }
      if (reg && (reg.length < 2 || reg.length > 30)) { S.err = 'El número de registro de tránsito debe tener entre 2 y 30 caracteres.'; render(); break; }
      const dir = String(S.f.amDir || '').trim().replace(/\s+/g, ' '), tel = cleanTel(S.f.amTel);
      if (!validDir(dir)) { S.err = 'Escribe la dirección de residencia del conductor (mínimo 5 caracteres).'; render(); break; }
      if (tel.length !== 10) { S.err = 'El celular debe tener 10 dígitos.'; render(); break; }
      S.busy = true; render();
      try {
        const d = { nombre: u.nombre, moto, color, placa, estado: 'aprobado', aprobadoSinDocs: true, creado: serverTimestamp() }; if (reg) d.registro = reg;
        const bt = writeBatch(db); bt.set(doc(db, 'conductores', v), d); bt.set(privRef(v), { direccion: dir, telefono: tel, actualizado: serverTimestamp() }); await bt.commit();
        S.admPriv[v] = { direccion: dir, telefono: tel }; S.admMake = null; S.busy = false; S.banner = { kind: 'ok', text: u.nombre + ' quedó habilitado como conductor.' }; render();
      } catch (e) { fail(e); }
      break;
    }
    case 'admForce':
      if (!S.f['force_' + v]) break;
      S.busy = true; render();
      try { await updateDoc(doc(db, 'conductores', v), { estado: 'aprobado', aprobadoSinDocs: true }); S.busy = false; render(); } catch (e) { fail(e); }
      break;
    case 'admDriver': {
      const hoy = new Date(); S.admBack = S.admTab === 'usuarios' ? 'usuarios' : 'conductores'; S.admDriver = v; S.admTab = 'detalle'; S.admRes = null;
      S.f.admIni = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); S.f.admFin = ymd(hoy);
      window.scrollTo(0, 0); loadDriverTrips(v); break;
    }
    case 'admRango': {
      const d = new Date(), y = d.getFullYear(), m = d.getMonth();
      const r = { hoy: [d, d], '7d': [new Date(y, m, d.getDate() - 6), d], mes: [new Date(y, m, 1), d], mesant: [new Date(y, m - 1, 1), new Date(y, m, 0)] }[v];
      S.f.admIni = ymd(r[0]); S.f.admFin = ymd(r[1]); calcDriver(); render(); break;
    }
    case 'admConsultar': calcDriver(); render(); break;
    case 'admCsv': {
      const r = S.admRes, c = (S.adm.conductores || []).find(x => x.id === S.admDriver); if (!r || !c) break;
      const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const filas = [['Fecha', 'Pasajero', 'Destino', 'Forma de pago', 'Valor']].concat(r.fin.map(v => [fmtFecha(r.ts(v)), v.pasajeroNombre, v.destino ? v.destino.texto : '', pagoTxt(v), v.precioFinal || 0]));
      filas.push([], ['Servicios prestados', r.fin.length], ['Ingresos recibidos', r.total], ['Efectivo', r.ef], ['Transferencia', r.tr]);
      const csv = '\ufeff' + [['Conductor', c.nombre], ['Placa', c.placa], ['Periodo', 'Del ' + r.iniTxt + ' al ' + r.finTxt], []].concat(filas).map(f => f.map(q).join(';')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), el = document.createElement('a');
      el.href = url; el.download = 'servicios_' + c.placa + '_' + S.f.admIni + '_a_' + S.f.admFin + '.csv'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }
    case 'admReview': S.admTab = 'conductores'; S.admOpen = null; render(); window.scrollTo(0, 0); act('admDocs', v); break;
    case 'admDocs':
      if (S.admOpen === v) { S.admOpen = null; S.admBig = null; render(); break; }
      S.admOpen = v; S.admBig = null; S.admDocs[v] = 'cargando'; render();
      try { const qs = await getDocs(collection(db, 'conductores', v, 'documentos')); const m = {}; qs.docs.forEach(x => { m[x.id] = x.data().img; }); S.admDocs[v] = m; } catch (e) { S.admDocs[v] = {}; S.err = errMsg(e); }
      try { const p = await getDoc(privRef(v)); S.admPriv[v] = p.exists() ? p.data() : {}; } catch (e) { S.admPriv[v] = {}; }
      render(); break;
    case 'aeIdTipo': S.f.aeIdTipo = v; render(); break;
    case 'admBig': S.admBig = S.admBig === v ? null : v; render(); break;
    case 'admEdit': {
      S.admEdit = v || null; S.err = null;
      if (v) { const c = (S.adm.conductores || []).find(x => x.id === v) || {}, pv = S.admPriv[v] || {}, u = (S.admUsers || []).find(x => x.id === v) || {};
        S.f.aeMoto = c.moto || ''; S.f.aeColor = c.color || ''; S.f.aePlaca = c.placa || ''; S.f.aeReg = c.registro || ''; S.f.aeDir = pv.direccion || ''; S.f.aeTel = pv.telefono || u.telefono || ''; S.f.aeIdTipo = c.idTipo || ''; S.f.aeIdNum = pv.idNumero || ''; }
      render(); break;
    }
    case 'admEditSave': {
      const moto = (S.f.aeMoto || '').trim(), color = (S.f.aeColor || '').trim(), placa = (S.f.aePlaca || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), reg = String(S.f.aeReg || '').trim().replace(/\s+/g, ' ').toUpperCase();
      const dir = String(S.f.aeDir || '').trim().replace(/\s+/g, ' '), tel = cleanTel(S.f.aeTel);
      if (moto.length < 2 || color.length < 2) { S.err = 'Escribe la marca, el modelo y el color del mototour.'; render(); break; }
      if (!/^[A-Z0-9]{5,7}$/.test(placa) || !/[A-Z]/.test(placa) || !/[0-9]/.test(placa)) { S.err = 'La placa debe tener entre 5 y 7 letras y números, por ejemplo ABC12D.'; render(); break; }
      if (reg && (reg.length < 2 || reg.length > 30)) { S.err = 'El número de registro de tránsito debe tener entre 2 y 30 caracteres.'; render(); break; }
      if (!validDir(dir)) { S.err = 'Escribe la dirección de residencia del conductor (mínimo 5 caracteres).'; render(); break; }
      if (tel.length !== 10) { S.err = 'El celular debe tener 10 dígitos.'; render(); break; }
      const idT = S.f.aeIdTipo || '', idN = cleanId(S.f.aeIdNum);
      if (idT || idN) { const er = idErr(idT, idN); if (er) { S.err = er; render(); break; } }
      S.busy = true; render();
      try {
        const bt = writeBatch(db), upd = { moto, color, placa };
        if (reg) upd.registro = reg;
        if (idT) upd.idTipo = idT;
        bt.update(doc(db, 'conductores', v), upd);
        const pd = { direccion: dir, telefono: tel, actualizado: serverTimestamp() }; if (idN) pd.idNumero = idN;
        bt.set(privRef(v), pd);
        await bt.commit();
        S.admPriv[v] = { direccion: dir, telefono: tel, idNumero: idN || undefined }; S.admEdit = null; S.busy = false; S.banner = { kind: 'ok', text: 'Datos del conductor guardados.' }; render();
      } catch (e) { fail(e); }
      break;
    }
    case 'admSet': S.busy = true; render(); try { const est = b.getAttribute('data-p'); await updateDoc(doc(db, 'conductores', v), { estado: est }); if (est !== 'aprobado') updateDoc(doc(db, 'push', v), { online: false }).catch(() => { }); S.busy = false; render(); } catch (e) { fail(e); } break;
    case 'admAlert': S.busy = true; render(); try { await updateDoc(doc(db, 'alertas', v), { estado: 'atendida' }); S.busy = false; render(); } catch (e) { fail(e); } break;
  }
}
function beepUnlock() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { } }
function endPassengerTrip() { S.envCod = null; S.recibe = null; S.f.recNom = ''; S.f.recTel = ''; S.f.envDesc = ''; S.f.envCont = ''; S.f.envOk = false; S.pagaRecibe = false; S.viajeId = null; S.viaje = null; S.ofertas = []; S.sos = null; S.cPhone = null; S.cTransfer = null; S.pago = 'efectivo'; S.drvPos = null; S.route = null; S.destPin = null; S.pickDest = false; S.sharing = false; stopWatch(); S.offer = MIN; S.f.destino = ''; S.f.ref = ''; S.f.nota = ''; S.notaOpen = false; go('home'); }
function endDriverTrip() { S.recibe = null; S.devAsk = false; S.f.codEnt = ''; S.f.devMotivo = ''; S.viajeId = null; S.viaje = null; S.sos = null; S.pPhone = null; S.paxPos = null; S.route = null; S.stats = null; S.banner = { kind: 'ok', text: 'Viaje finalizado. Sigues conectado.' }; go('solicitudes'); }
document.addEventListener('pointerdown', beepUnlock, { once: true });
appEl.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; act(b.getAttribute('data-act'), b.getAttribute('data-v'), b); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { });
