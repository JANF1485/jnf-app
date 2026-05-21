// MODULO DESCARGA MASIVA CUFE - JNF SAS
var _cufeState = {
  excelDian: null,
  formatoWb: null,
  formatoData: null,
  cufeList: [],
  resultados: [],
  pestanasSelec: [],
  dianWindow: null,
  procesando: false,
  pausado: false,
  idxActual: 0,
  ok: 0,
  err: 0,
  pestanasConfig: {
    'COSTOS':        { tipo: 'compra',    formato: '1001' },
    'DV COSTOS':     { tipo: 'devcompra', formato: '1001' },
    'VENTAS':        { tipo: 'venta',     formato: '1007' },
    'DEV EN VENTAS': { tipo: 'devventa',  formato: '1007' },
    'SERV PUBLICOS': { tipo: 'compra',    formato: '1001' },
    'DOC. SOPORTE':  { tipo: 'compra',    formato: '1001' }
  }
};

window._openCufe = window.openCufe = function() {
  var cl = clients ? clients.find(function(x) { return x.id === activeClientId; }) : null;
  var year = activeYear || new Date().getFullYear();
  var el = document.getElementById('cufe-subtitulo');
  if (el) el.textContent = cl ? (cl.razon || cl.nit) + ' - ' + year : 'Descarga Masiva CUFE - ' + year;
  _cufeState.excelDian = null;
  _cufeState.formatoData = null;
  _cufeState.cufeList = [];
  _cufeState.resultados = [];
  _cufeState.procesando = false;
  _cufeState.pausado = false;
  _cufeState.idxActual = 0;
  _cufeState.ok = 0;
  _cufeState.err = 0;
  cufeResetUI();
  showScreen('cufe');
};

function ge(id) { return document.getElementById(id); }

function cufeResetUI() {
  var pasos = ['cufe-paso1','cufe-paso2','cufe-paso3','cufe-paso4','cufe-paso5'];
  pasos.forEach(function(id, i) {
    var el = ge(id);
    if (el) el.className = 'cufe-paso' + (i === 0 ? ' activo' : '');
    var n = ge('cufe-n' + (i + 1));
    if (n) { n.className = 'cufe-num' + (i === 0 ? ' activo' : ''); n.textContent = String(i + 1); }
  });
  var hideIds = ['cufe-paso1-info','cufe-paso2-info','cufe-progreso-card','cufe-resultados-card'];
  hideIds.forEach(function(id) { var el = ge(id); if (el) el.style.display = 'none'; });
  var bd = ge('cufe-btn-abrir-dian'); if (bd) bd.disabled = true;
  var bi = ge('cufe-btn-iniciar');    if (bi) bi.disabled = true;
  var bs = ge('cufe-btn-sesion-ok');  if (bs) bs.style.display = 'none';
  var an = ge('cufe-archivo-nombre'); if (an) an.textContent = '';
  var fn = ge('cufe-formato-nombre'); if (fn) fn.textContent = '';
  var bl = ge('cufe-btn-formato');
  if (bl) { bl.style.background = '#e5e7f0'; bl.style.color = '#9ca3af'; bl.style.pointerEvents = 'none'; }
  var pc = ge('cufe-pestanas-check'); if (pc) pc.innerHTML = '';
}

function cufePasoActivo(n) {
  for (var i = 1; i <= 5; i++) {
    var el  = ge('cufe-paso' + i);
    var num = ge('cufe-n' + i);
    if (!el || !num) continue;
    if (i < n)      { el.className = 'cufe-paso completado'; num.className = 'cufe-num completado'; num.textContent = String.fromCharCode(10003); }
    else if (i === n){ el.className = 'cufe-paso activo';    num.className = 'cufe-num activo';    num.textContent = String(i); }
    else             { el.className = 'cufe-paso';            num.className = 'cufe-num';           num.textContent = String(i); }
  }
}

function cufeLog(tipo, msg) {
  var card = ge('cufe-progreso-card');
  if (card) card.style.display = 'block';
  var log = ge('cufe-log');
  if (!log) return;
  var div = document.createElement('div');
  div.className = tipo;
  var ts = new Date().toLocaleTimeString('es-CO');
  div.textContent = '[' + ts + '] ' + msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

window.cufeCargarExcel = function(input) {
  var file = input.files[0];
  if (!file) return;
  var an = ge('cufe-archivo-nombre');
  if (an) an.textContent = 'Leyendo...';
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'binary' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo no tiene datos.'); return; }
      var headers = rows[0].map(function(h) { return String(h).trim(); });
      var iCufe   = headers.findIndex(function(h) { return /CUFE|UUID/i.test(h); });
      var iNitE   = headers.findIndex(function(h) { return /NIT\s*Emisor/i.test(h); });
      var iNitR   = headers.findIndex(function(h) { return /NIT\s*Receptor/i.test(h); });
      var iNit    = headers.findIndex(function(h) { return /^NIT$/i.test(h); });
      var iNombre = headers.findIndex(function(h) { return /Nombre\s*(Emisor|Receptor)/i.test(h); });
      var iIVA    = headers.findIndex(function(h) { return h === 'IVA'; });
      var iTotal  = headers.findIndex(function(h) { return h === 'Total'; });
      var iReteR  = headers.findIndex(function(h) { return /Rete\s*Renta/i.test(h); });
      var iReteI  = headers.findIndex(function(h) { return /Rete\s*IVA/i.test(h); });
      var iTipo   = headers.findIndex(function(h) { return /Tipo\s*de\s*documento/i.test(h); });
      if (iCufe < 0) { alert('No se encontro la columna CUFE/UUID.'); return; }
      var tipos = {};
      var datos = [];
      rows.slice(1).forEach(function(row) {
        var cufe = String(row[iCufe] || '').trim();
        if (!cufe) return;
        var tipo = String(row[iTipo] || '').trim();
        tipos[tipo] = (tipos[tipo] || 0) + 1;
        var nitIdx = iNitE >= 0 ? iNitE : (iNit >= 0 ? iNit : iNitR);
        datos.push({
          cufe: cufe, tipo: tipo,
          nit: String(row[nitIdx] || '').trim(),
          nombre: String(row[iNombre >= 0 ? iNombre : 0] || '').trim(),
          iva: parseFloat(row[iIVA]) || 0,
          total: parseFloat(row[iTotal]) || 0,
          reteRenta: parseFloat(row[iReteR]) || 0,
          reteIVA: parseFloat(row[iReteI]) || 0,
          estado: 'pendiente', base19: 0, base5: 0, exento: 0, excluido: 0, iva19: 0, iva5: 0
        });
      });
      _cufeState.excelDian = datos;
      if (an) an.textContent = String.fromCharCode(10003) + ' ' + file.name;
      var tf = ge('cufe-total-facturas');
      if (tf) tf.textContent = datos.length + ' facturas encontradas';
      var td = ge('cufe-tipos-doc');
      if (td) td.textContent = Object.entries(tipos).map(function(e) { return e[1] + ' ' + e[0]; }).join(' - ');
      var pi = ge('cufe-paso1-info');
      if (pi) pi.style.display = 'block';
      cufePasoActivo(2);
      var btnF = ge('cufe-btn-formato');
      if (btnF) { btnF.style.background = '#1a2580'; btnF.style.color = '#fff'; btnF.style.pointerEvents = 'auto'; }
    } catch(err) {
      alert('Error leyendo el archivo: ' + err.message);
      if (an) an.textContent = 'Error';
    }
  };
  reader.readAsBinaryString(file);
};

window.cufeCargarFormato = function(input) {
  var file = input.files[0];
  if (!file) return;
  var fn = ge('cufe-formato-nombre');
  if (fn) fn.textContent = 'Leyendo...';
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'binary' });
      _cufeState.formatoWb = wb;
      _cufeState.formatoData = {};
      var conf = _cufeState.pestanasConfig;
      var conCufe = [];
      wb.SheetNames.forEach(function(shName) {
        if (!conf[shName]) return;
        var ws = wb.Sheets[shName];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        var hrow = -1;
        for (var i = 0; i < Math.min(rows.length, 8); i++) {
          var r = rows[i].map(function(v) { return String(v).toUpperCase().trim(); });
          if (r.some(function(v) { return v === 'CUFE/CUDE' || v === 'CUFE'; })) { hrow = i; break; }
        }
        if (hrow < 0) return;
        var headers = rows[hrow].map(function(v) { return String(v).trim(); });
        var iCufe = headers.findIndex(function(h) { return /CUFE/i.test(h); });
        if (iCufe < 0) return;
        var cufeFilas = [];
        rows.forEach(function(row, ri) {
          if (ri <= hrow) return;
          var cufe = String(row[iCufe] || '').trim();
          if (cufe && cufe.length > 20) cufeFilas.push({ fila: ri, cufe: cufe, row: row });
        });
        if (cufeFilas.length > 0) {
          _cufeState.formatoData[shName] = { headers: headers, hrow: hrow, rows: rows, iCufe: iCufe, cufeFilas: cufeFilas, config: conf[shName] };
          conCufe.push(shName + '(' + cufeFilas.length + ')');
        }
      });
      if (fn) fn.textContent = String.fromCharCode(10003) + ' ' + file.name;
      var fp = ge('cufe-formato-pestanas');
      if (fp) fp.textContent = 'Con CUFE: ' + conCufe.join(', ');
      var pi2 = ge('cufe-paso2-info');
      if (pi2) pi2.style.display = 'block';
      cufePasoActivo(3);
      var cont = ge('cufe-pestanas-check');
      if (cont) {
        cont.innerHTML = '';
        cont.style.display = 'flex';
        Object.keys(_cufeState.formatoData).forEach(function(shName) {
          var dat = _cufeState.formatoData[shName];
          var lbl = document.createElement('label');
          lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 14px;border:1.5px solid #e5e7f0;border-radius:20px;cursor:pointer;font-size:11px;font-weight:700;color:#1a2580;font-family:Montserrat,sans-serif;';
          var chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.checked = true;
          chk.dataset.sh = shName;
          chk.style.accentColor = '#1a2580';
          chk.onchange = cufeActualizarSeleccion;
          lbl.appendChild(chk);
          lbl.appendChild(document.createTextNode(' ' + shName + ' (' + dat.cufeFilas.length + ')'));
          cont.appendChild(lbl);
        });
        cufeActualizarSeleccion();
      }
    } catch(err) {
      alert('Error leyendo el formato: ' + err.message);
      if (fn) fn.textContent = 'Error';
    }
  };
  reader.readAsBinaryString(file);
};

function cufeActualizarSeleccion() {
  var checks = document.querySelectorAll('#cufe-pestanas-check input[type=checkbox]');
  _cufeState.pestanasSelec = [];
  checks.forEach(function(cb) { if (cb.checked) _cufeState.pestanasSelec.push(cb.dataset.sh); });
  if (_cufeState.pestanasSelec.length > 0) {
    cufePasoActivo(4);
    var bd = ge('cufe-btn-abrir-dian');
    if (bd) bd.disabled = false;
  }
}

window.cufeAbrirDian = function() {
  _cufeState.dianWindow = window.open('https://catalogo-vpfe.dian.gov.co/User/SearchDocument', 'dian_portal', 'width=1100,height=750,resizable=yes,scrollbars=yes');
  var bs = ge('cufe-btn-sesion-ok');
  if (bs) bs.style.display = 'inline-block';
  cufeLog('info', 'Portal DIAN abierto. Inicia sesion y regresa aqui.');
};

window.cufeSesionOk = function() {
  cufePasoActivo(5);
  var bi = ge('cufe-btn-iniciar');
  if (bi) bi.disabled = false;
  cufeLog('ok', 'Sesion confirmada. Listo para iniciar.');
};

window.cufeIniciarProceso = function() {
  _cufeState.cufeList = [];
  _cufeState.pestanasSelec.forEach(function(shName) {
    var dat = _cufeState.formatoData[shName];
    if (!dat) return;
    dat.cufeFilas.forEach(function(cf) {
      _cufeState.cufeList.push({
        cufe: cf.cufe, sh: shName, fila: cf.fila,
        config: dat.config, estado: 'pendiente',
        base19: 0, base5: 0, exento: 0, excluido: 0,
        iva19: 0, iva5: 0, reteRenta: 0, reteIVA: 0,
        total: 0, nit: '', nombre: '', error: ''
      });
    });
  });
  if (_cufeState.cufeList.length === 0) { alert('No hay CUFEs para procesar.'); return; }
  _cufeState.procesando = true;
  _cufeState.pausado = false;
  _cufeState.idxActual = 0;
  _cufeState.ok = 0;
  _cufeState.err = 0;
  var card = ge('cufe-progreso-card');
  if (card) card.style.display = 'block';
  var ct = ge('cufe-cnt-total'); if (ct) ct.textContent = _cufeState.cufeList.length;
  var cp = ge('cufe-cnt-pend');  if (cp) cp.textContent = _cufeState.cufeList.length;
  var co = ge('cufe-cnt-ok');    if (co) co.textContent = '0';
  var ce = ge('cufe-cnt-err');   if (ce) ce.textContent = '0';
  var bi = ge('cufe-btn-iniciar'); if (bi) bi.disabled = true;
  cufeLog('info', 'Iniciando ' + _cufeState.cufeList.length + ' facturas...');
  cufeProcesamientoCiclo();
};

function cufeProcesamientoCiclo() {
  if (!_cufeState.procesando || _cufeState.pausado) return;
  var idx = _cufeState.idxActual;
  var lista = _cufeState.cufeList;
  if (idx >= lista.length) { cufeFinalizarProceso(); return; }
  var item = lista[idx];
  var total = lista.length;
  var pct = Math.round((idx / total) * 100);
  var bar = ge('cufe-barra'); if (bar) bar.style.width = pct + '%';
  var txt = ge('cufe-progreso-txt');
  if (txt) txt.textContent = 'Procesando ' + (idx + 1) + ' de ' + total + ' - ' + item.sh + ': ' + item.cufe.substring(0, 20) + '...';
  var cp = ge('cufe-cnt-pend'); if (cp) cp.textContent = String(total - idx);
  cufeLog('info', '[' + (idx + 1) + '/' + total + '] ' + item.sh + ': ' + item.cufe.substring(0, 30) + '...');
  cufeBuscarCufe(item, function(resultado) {
    if (resultado.ok) {
      item.estado   = 'ok';
      item.base19   = resultado.base19   || 0;
      item.base5    = resultado.base5    || 0;
      item.exento   = resultado.exento   || 0;
      item.excluido = resultado.excluido || 0;
      item.iva19    = resultado.iva19    || 0;
      item.iva5     = resultado.iva5     || 0;
      item.reteRenta= resultado.reteRenta|| 0;
      item.reteIVA  = resultado.reteIVA  || 0;
      item.total    = resultado.total    || 0;
      item.nit      = resultado.nit      || item.nit || '';
      item.nombre   = resultado.nombre   || item.nombre || '';
      _cufeState.ok++;
      var co = ge('cufe-cnt-ok'); if (co) co.textContent = String(_cufeState.ok);
      cufeLog('ok', 'OK - Base19: $' + Math.round(item.base19).toLocaleString('es-CO') + ' | Exento: $' + Math.round(item.exento).toLocaleString('es-CO'));
    } else {
      item.estado = 'error';
      item.error  = resultado.error || 'Error desconocido';
      _cufeState.err++;
      var ce = ge('cufe-cnt-err'); if (ce) ce.textContent = String(_cufeState.err);
      cufeLog('err', 'Error: ' + item.error);
    }
    _cufeState.idxActual++;
    setTimeout(cufeProcesamientoCiclo, 1500);
  });
}

function cufeBuscarCufe(item, callback) {
  var dianWin = _cufeState.dianWindow;
  if (!dianWin || dianWin.closed) {
    _cufeState.pausado = true;
    var bs = ge('cufe-btn-sesion-ok'); if (bs) bs.style.display = 'inline-block';
    var bp = ge('cufe-btn-pausar'); if (bp) bp.textContent = 'Reanudar';
    cufeLog('err', 'Ventana DIAN cerrada. Reabrir y hacer clic en Sesion OK.');
    callback({ ok: false, error: 'Ventana DIAN cerrada' });
    return;
  }
  // Intentar fetch con credenciales de sesion
  var url = 'https://catalogo-vpfe.dian.gov.co/Document/FindDocument?documentKey=' + encodeURIComponent(item.cufe);
  fetch(url, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json,text/html,*/*', 'X-Requested-With': 'XMLHttpRequest' } })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') >= 0) return r.json().then(function(d) { cufeParsearJSON(d, item, callback); });
      return r.text().then(function(t) { cufeParsearTexto(t, item, callback); });
    })
    .catch(function() {
      cufeCalcularDesdeExcel(item, callback);
    });
}

function cufeParsearJSON(data, item, callback) {
  try {
    var t = data.totals || data.Totals || data.totales || data;
    callback({
      ok: true,
      base19:    t.subtotalTaxableAmount19 || t.baseGravada19 || 0,
      base5:     t.subtotalTaxableAmount5  || t.baseGravada5  || 0,
      exento:    t.subtotalExempt          || t.baseExenta    || 0,
      excluido:  t.subtotalExcluded        || t.baseExcluida  || 0,
      iva19:     t.taxAmount19             || t.iva19         || 0,
      iva5:      t.taxAmount5              || t.iva5          || 0,
      reteRenta: t.withholdingTax          || t.reteFuente    || 0,
      reteIVA:   t.withholdingVAT          || t.reteIVA       || 0,
      total:     t.payableAmount           || t.totalFactura  || 0,
      nit:       String(data.supplierNIT   || data.nitEmisor  || item.nit    || ''),
      nombre:    String(data.supplierName  || data.nombreEmisor|| item.nombre|| '')
    });
  } catch(e) {
    cufeCalcularDesdeExcel(item, callback);
  }
}

function cufeParsearTexto(html, item, callback) {
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  var text = tmp.innerText || tmp.textContent || '';
  function extraer(patron) {
    var m = text.match(patron);
    if (!m) return 0;
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0;
  }
  var subtotal = extraer(/Subtotal[\s\S]{0,50}?([\d.,]+)/);
  var iva      = extraer(/\bIVA\b[\s\S]{0,30}?([\d.,]+)/);
  var reteF    = extraer(/Rete\s*fuente[\s\S]{0,30}?([\d.,]+)/i);
  var reteI    = extraer(/Rete\s*IVA[\s\S]{0,30}?([\d.,]+)/i);
  var totalF   = extraer(/Total\s*factura[\s\S]{0,30}?([\d.,]+)/i);
  if (subtotal > 0) {
    var res = { ok: true, reteRenta: reteF, reteIVA: reteI, total: totalF || subtotal + iva };
    if (iva > 0) {
      var pct = iva / subtotal;
      if (Math.abs(pct - 0.19) < 0.01) { res.base19 = subtotal; res.iva19 = iva; }
      else if (Math.abs(pct - 0.05) < 0.01) { res.base5 = subtotal; res.iva5 = iva; }
      else { res.base19 = subtotal; res.iva19 = iva; }
    } else {
      res.exento = subtotal;
    }
    callback(res);
  } else {
    cufeCalcularDesdeExcel(item, callback);
  }
}

function cufeCalcularDesdeExcel(item, callback) {
  var dianData = _cufeState.excelDian || [];
  var match = dianData.find(function(r) { return r.cufe === item.cufe; });
  if (match && match.total > 0) {
    var iva = match.iva || 0;
    var sub = match.total - iva;
    var res = { ok: true, reteRenta: match.reteRenta, reteIVA: match.reteIVA, total: match.total, nit: match.nit, nombre: match.nombre };
    if (iva > 0) {
      var pct = iva / sub;
      if (Math.abs(pct - 0.19) < 0.01) { res.base19 = sub; res.iva19 = iva; }
      else if (Math.abs(pct - 0.05) < 0.01) { res.base5 = sub; res.iva5 = iva; }
      else { res.base19 = sub; res.iva19 = iva; }
    } else {
      res.exento = sub;
    }
    cufeLog('info', 'Calculado desde Excel DIAN (sin discriminacion exacta)');
    callback(res);
  } else {
    callback({ ok: false, error: 'CUFE no encontrado en Excel ni portal DIAN' });
  }
}

window.cufePausar = function() {
  _cufeState.pausado = !_cufeState.pausado;
  var bp = ge('cufe-btn-pausar');
  if (bp) bp.textContent = _cufeState.pausado ? 'Reanudar' : 'Pausar';
  if (!_cufeState.pausado) cufeProcesamientoCiclo();
};

window.cufeCancelar = function() {
  _cufeState.procesando = false;
  _cufeState.pausado = false;
  cufeLog('err', 'Proceso cancelado.');
  cufeFinalizarProceso();
};

function cufeFinalizarProceso() {
  _cufeState.procesando = false;
  var bar = ge('cufe-barra'); if (bar) bar.style.width = '100%';
  var cp = ge('cufe-cnt-pend'); if (cp) cp.textContent = '0';
  var txt = ge('cufe-progreso-txt'); if (txt) txt.textContent = 'Proceso finalizado';
  cufeLog('ok', 'Completado: ' + _cufeState.ok + ' OK, ' + _cufeState.err + ' errores.');
  var card = ge('cufe-resultados-card');
  if (card) card.style.display = 'block';
  cufeMostrarTabla();
}

function fmtCOP(n) { return n ? '$' + Math.round(n).toLocaleString('es-CO') : '$0'; }

function cufeMostrarTabla() {
  var lista = _cufeState.cufeList;
  var html = '<div style="overflow-x:auto;"><table class="cufe-tabla"><thead><tr>'
    + '<th>Pestana</th><th>NIT</th><th>Nombre</th>'
    + '<th>Base 19%</th><th>Base 5%</th><th>Exento</th><th>IVA 19%</th><th>IVA 5%</th>'
    + '<th>Rete Fuente</th><th>Rete IVA</th><th>Estado</th>'
    + '</tr></thead><tbody>';
  lista.forEach(function(item) {
    var tag = item.estado === 'ok' ? 'ok' : item.estado === 'error' ? 'error' : 'pending';
    var lbl = item.estado === 'ok' ? 'OK' : item.estado === 'error' ? 'Error' : 'Pendiente';
    html += '<tr>'
      + '<td><b>' + item.sh + '</b></td>'
      + '<td>' + item.nit + '</td>'
      + '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">' + item.nombre + '</td>'
      + '<td>' + fmtCOP(item.base19)    + '</td>'
      + '<td>' + fmtCOP(item.base5)     + '</td>'
      + '<td>' + fmtCOP(item.exento)    + '</td>'
      + '<td>' + fmtCOP(item.iva19)     + '</td>'
      + '<td>' + fmtCOP(item.iva5)      + '</td>'
      + '<td>' + fmtCOP(item.reteRenta) + '</td>'
      + '<td>' + fmtCOP(item.reteIVA)   + '</td>'
      + '<td><span class="cufe-tag ' + tag + '">' + lbl + '</span>'
      + (item.error ? '<div style="font-size:9px;color:#dc2626;">' + item.error + '</div>' : '')
      + '</td></tr>';
  });
  html += '</tbody></table></div>';
  var cont = ge('cufe-tabla-resultados');
  if (cont) cont.innerHTML = html;
}

window.cufeDescargarExcel = function() {
  if (!_cufeState.formatoWb) { alert('No hay formato contable cargado.'); return; }
  var wbOut = XLSX.utils.book_new();
  _cufeState.pestanasSelec.forEach(function(shName) {
    var dat = _cufeState.formatoData[shName];
    if (!dat) return;
    var rows = dat.rows.map(function(r) { return r.slice(); });
    var headers = dat.headers.slice();
    function findOrAdd(name) {
      var i = headers.findIndex(function(h) { return h === name; });
      if (i >= 0) return i;
      headers.push(name);
      if (rows[dat.hrow]) rows[dat.hrow].push(name);
      return headers.length - 1;
    }
    var iB19 = findOrAdd('BASE 19');
    var iB5  = findOrAdd('BASE 5');
    var iEx  = findOrAdd('EXENTO');
    var iExc = findOrAdd('EXCLUIDO');
    var iI19 = findOrAdd('IVA19%');
    var iI5  = findOrAdd('IVA 5%');
    var iRF  = findOrAdd('APLIC. RETEFUENTE');
    var iRI  = findOrAdd('RETEIVA');
    var mapCufe = {};
    _cufeState.cufeList.forEach(function(item) {
      if (item.sh === shName && item.estado === 'ok') mapCufe[item.cufe] = item;
    });
    dat.cufeFilas.forEach(function(cf) {
      var item = mapCufe[cf.cufe];
      if (!item) return;
      var row = rows[cf.fila];
      var maxIdx = Math.max(iB19, iB5, iEx, iExc, iI19, iI5, iRF, iRI);
      while (row.length <= maxIdx) row.push('');
      row[iB19] = item.base19   || 0;
      row[iB5]  = item.base5    || 0;
      row[iEx]  = item.exento   || 0;
      row[iExc] = item.excluido || 0;
      row[iI19] = item.iva19    || 0;
      row[iI5]  = item.iva5     || 0;
      row[iRF]  = item.reteRenta|| 0;
      row[iRI]  = item.reteIVA  || 0;
    });
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wbOut, ws, shName);
  });
  var hoy = new Date().toLocaleDateString('es-CO').replace(/\//g, '-');
  XLSX.writeFile(wbOut, 'FormatoContable_CUFE_' + hoy + '.xlsx');
  cufeLog('ok', 'Excel enriquecido descargado.');
};

window.cufeNuevoProceso = function() {
  _cufeState.excelDian   = null;
  _cufeState.formatoWb   = null;
  _cufeState.formatoData = null;
  _cufeState.cufeList    = [];
  _cufeState.resultados  = [];
  _cufeState.pestanasSelec = [];
  _cufeState.procesando  = false;
  _cufeState.pausado     = false;
  _cufeState.idxActual   = 0;
  _cufeState.ok          = 0;
  _cufeState.err         = 0;
  cufeResetUI();
};
