import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Upload,
  FileText,
  Scissors,
  Merge,
  Download,
  RefreshCw,
  CheckCircle,
  Layers,
  AlertCircle,
  Eye,
  FileCheck,
  Info,
  Trash2,
  Undo2
} from 'lucide-react';

export default function App() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);

  // PDF.js variables
  const [pdfDocument, setPdfDocument] = useState(null);
  const [thumbnails, setThumbnails] = useState({});
  const [renderProgress, setRenderProgress] = useState(0);

  // Split boundaries state: Set of page indices that START a new invoice
  const [splitIndices, setSplitIndices] = useState(new Set());

  // Grupos excluidos del ZIP (por índice de su página de inicio), p.ej. duplicados
  const [excluded, setExcluded] = useState(new Set());

  // Páginas descartadas: no salen en ningún PDF. Para hojas repetidas dentro
  // del mismo documento (la misma factura impresa dos veces), portadas, etc.
  const [dropped, setDropped] = useState(new Set());

  // Reasignación manual de páginas a otra factura: { pageIdx: startIdxDestino }
  // Permite agrupar páginas NO contiguas (p.ej. juntar una "Página 2 de 3"
  // desordenada con su factura de inicio).
  const [reassign, setReassign] = useState({});

  // UI states
  const [activeTab, setActiveTab] = useState('grid'); // 'grid' or 'list'
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadBlob, setDownloadBlob] = useState(null);
  const [zipFilename, setZipFilename] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [previewPage, setPreviewPage] = useState(null);

  // File drop ref
  const dropRef = useRef(null);

  // Drag & drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setErrorMsg('');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const selectedFile = files[0];
      if (selectedFile.type === 'application/pdf' || selectedFile.name.endsWith('.pdf')) {
        processFile(selectedFile);
      } else {
        setErrorMsg('Por favor, selecciona un archivo PDF válido.');
      }
    }
  };

  const handleFileChange = (e) => {
    setErrorMsg('');
    if (e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  // Process the selected PDF file
  const processFile = async (selectedFile) => {
    setFile(selectedFile);
    setPages([]);
    setThumbnails({});
    setSplitIndices(new Set());
    setExcluded(new Set());
    setDropped(new Set());
    setReassign({});
    setDownloadBlob(null);
    setIsAnalyzing(true);

    // 1. Analyze PDF on backend
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await axios.post('/api/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPages(response.data.pages);

      // Initialize splits from backend heuristics
      const initialSplits = new Set(
        response.data.pages.filter(p => p.is_start).map(p => p.page_index)
      );
      // Ensure page 0 is always a split point
      initialSplits.add(0);
      setSplitIndices(initialSplits);

      // Excluir por defecto los duplicados (página de inicio marcada como duplicada)
      const initialExcluded = new Set(
        response.data.pages.filter(p => p.is_start && p.duplicate).map(p => p.page_index)
      );
      setExcluded(initialExcluded);

      // 2. Load PDF locally for rendering thumbnails using PDF.js
      const fileReader = new FileReader();
      fileReader.onload = async function () {
        try {
          const typedarray = new Uint8Array(this.result);
          // Get the pdfjs instance loaded from CDN
          if (!window.pdfjsLib) {
            console.error('PDF.js not loaded from CDN yet.');
            return;
          }
          const pdf = await window.pdfjsLib.getDocument({ data: typedarray }).promise;
          setPdfDocument(pdf);
          renderThumbnails(pdf);
        } catch (err) {
          console.error('Error rendering local PDF thumbnails:', err);
        }
      };
      fileReader.readAsArrayBuffer(selectedFile);

    } catch (err) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || 'Ocurrió un error al analizar el PDF en el servidor.');
      setFile(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Render thumbnails in background
  const renderThumbnails = async (pdf) => {
    const total = pdf.numPages;
    for (let i = 1; i <= total; i++) {
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 }); // Small thumbnail
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        setThumbnails(prev => ({ ...prev, [i - 1]: dataUrl }));
        setRenderProgress(Math.round((i / total) * 100));
      } catch (e) {
        console.error(`Error rendering thumbnail for page ${i}:`, e);
      }
    }
  };

  // Toggle boundary cut point
  const toggleSplit = (pageIdx) => {
    if (pageIdx === 0) return; // Cannot unsplit first page
    setSplitIndices(prev => {
      const next = new Set(prev);
      if (next.has(pageIdx)) {
        next.delete(pageIdx);
      } else {
        next.add(pageIdx);
      }
      return next;
    });
  };

  // Incluir / excluir un grupo del ZIP (por índice de su página de inicio)
  const toggleExclude = (startIdx) => {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(startIdx) ? next.delete(startIdx) : next.add(startIdx);
      return next;
    });
  };

  // Descartar / recuperar una hoja suelta (no saldrá en ningún PDF generado)
  const toggleDrop = (pageIdx) => {
    setDropped(prev => {
      const next = new Set(prev);
      next.has(pageIdx) ? next.delete(pageIdx) : next.add(pageIdx);
      return next;
    });
  };

  // Factura "natural" (contigua) a la que pertenece una página por los cortes
  const naturalOwner = (i) => {
    let s = 0;
    for (const idx of splitIndices) { if (idx <= i && idx > s) s = idx; }
    return s;
  };

  // Mover una página a otra factura. Si el destino es su factura natural,
  // se elimina la reasignación (vuelve a su sitio).
  const moveTo = (pageIdx, targetStartIdx) => {
    setReassign(prev => {
      const next = { ...prev };
      const t = (targetStartIdx === null || targetStartIdx === undefined || targetStartIdx === '')
        ? null : Number(targetStartIdx);
      if (t === null || t === naturalOwner(pageIdx)) {
        delete next[pageIdx];
      } else {
        next[pageIdx] = t;
      }
      return next;
    });
  };

  // Group pages: primero por cortes contiguos, luego aplica reasignaciones manuales
  const getInvoiceGroups = () => {
    if (pages.length === 0) return [];

    // 1. Membresía contigua base (por los puntos de corte)
    const owner = {};            // pageIdx -> startIdx de su grupo
    let curStart = 0;
    for (let i = 0; i < pages.length; i++) {
      if (i === 0 || splitIndices.has(i)) curStart = i;
      owner[i] = curStart;
    }
    const validStarts = new Set(Object.values(owner));

    // 2. Reasignaciones manuales (solo a una factura que exista)
    for (let i = 0; i < pages.length; i++) {
      const t = reassign[i];
      if (t !== undefined && validStarts.has(t)) owner[i] = t;
    }

    // 3. Agrupar por dueño
    const byStart = {};
    for (let i = 0; i < pages.length; i++) {
      (byStart[owner[i]] = byStart[owner[i]] || []).push(i);
    }

    // 4. Construir grupos coherentes. 'allPages' son todas las del documento
    //    (para los datos y para pintarlas) y 'pages' solo las que iran al PDF:
    //    las descartadas se quedan fuera, pero el documento sigue existiendo.
    const groups = Object.entries(byStart)
      .filter(([, ps]) => ps.length)
      .map(([start, ps]) => {
        // Ordenar las páginas dentro de la factura por "Página X de Y", pero
        // solo si TODAS la traen: si el OCR la lee en unas hojas y en otras no,
        // mezclarlas dejaría el PDF desordenado. Si no, orden físico.
        const todasNumeradas = ps.every(i => pages[i].page_x);
        ps.sort((a, b) => (todasNumeradas ? pages[a].page_x - pages[b].page_x : 0) || (a - b));
        let supplier = null, document_number = null, duplicate = false, review = '';
        for (const i of ps) {
          const p = pages[i];
          if (!supplier && p.supplier !== 'DESCONOCIDO') supplier = p.supplier;
          if (!document_number && p.document_number) document_number = p.document_number;
          if (p.duplicate) duplicate = true;
          if (!review && p.review) review = p.review;
        }
        return {
          startIdx: Number(start), supplier, document_number, duplicate, review,
          allPages: ps, pages: ps.filter(i => !dropped.has(i)),
        };
      })
      .filter(g => g.pages.length)      // documento entero descartado: desaparece
      .sort((a, b) => a.startIdx - b.startIdx)
      .map((g, idx) => ({ ...g, id: idx }));

    return groups;
  };

  const invoiceGroups = getInvoiceGroups();
  const includedGroups = invoiceGroups.filter(g => !excluded.has(g.startIdx));
  // Mapas página -> nº de factura mostrado y -> startIdx de su factura
  const pageToInvoiceNo = {};
  const pageOwnerStart = {};
  invoiceGroups.forEach((g, idx) => g.allPages.forEach(p => {
    pageToInvoiceNo[p] = idx + 1;
    pageOwnerStart[p] = g.startIdx;
  }));
  const droppedCount = pages.filter((_, i) => dropped.has(i)).length;

  // Etiqueta corta para el selector "Mover a"
  const invoiceLabel = (g, idx) =>
    `#${idx + 1} ${(g.supplier || 'Doc').slice(0, 16)} (pág. ${g.startIdx + 1})`;
  const duplicateCount = invoiceGroups.filter(g => g.duplicate).length;
  const reviewCount = invoiceGroups.filter(g => g.review && !g.duplicate).length;

  // Execute PDF splitting on backend
  const handleSplitPdf = async () => {
    setIsSplitting(true);
    const formData = new FormData();
    formData.append('file', file);

    const payload = invoiceGroups
      .filter(g => !excluded.has(g.startIdx))
      .map((g, idx) => {
        const supplierName = g.supplier ? g.supplier.replace(/\s+/g, '_') : 'DOCUMENTO';
        const docNum = g.document_number ? g.document_number.replace(/[\/\s]+/g, '-') : 'S-N';
        const numStr = String(idx + 1).padStart(2, '0');
        return {
          filename: `${numStr}_${supplierName}_${docNum}.pdf`,
          pages: g.pages
        };
      });

    formData.append('groups', JSON.stringify(payload));
    const rotations = pages.map(p => p.rotation || 0);
    formData.append('rotations', JSON.stringify(rotations));

    try {
      const response = await axios.post('/api/split', formData, {
        responseType: 'blob',
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setDownloadBlob(response.data);
      const originalNameClean = file.name.replace(/\.pdf$/i, '');
      setZipFilename(`Dividido_${originalNameClean}.zip`);
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail || 'Error al procesar la división de archivos.';
      setErrorMsg(detail);
    } finally {
      setIsSplitting(false);
    }
  };

  // Download ZIP file
  const handleDownloadZip = () => {
    if (!downloadBlob) return;
    const url = window.URL.createObjectURL(downloadBlob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', zipFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  // Reset tool
  const handleReset = () => {
    setFile(null);
    setPages([]);
    setSplitIndices(new Set());
    setExcluded(new Set());
    setDropped(new Set());
    setReassign({});
    setDownloadBlob(null);
    setThumbnails({});
    setPdfDocument(null);
    setRenderProgress(0);
    setErrorMsg('');
  };

  // Colors for supplier badges
  const getSupplierColorClass = (supplier) => {
    if (!supplier) return 'bg-slate-800 text-slate-400 border-slate-700';

    const colors = {
      'TRIGORICO': 'bg-amber-950/50 text-amber-300 border-amber-800/40',
      'TRANSGOURMET': 'bg-blue-950/50 text-blue-300 border-blue-800/40',
      'DILLEPASA': 'bg-rose-950/50 text-rose-300 border-rose-800/40',
      'DEL MORAL': 'bg-cyan-950/50 text-cyan-300 border-cyan-800/40',
      'FRIT RAVICH': 'bg-orange-950/50 text-orange-300 border-orange-800/40',
      'SIMON COLL': 'bg-yellow-950/50 text-yellow-300 border-yellow-800/40',
      'UNIDROCO': 'bg-purple-950/50 text-purple-300 border-purple-800/40',
      'CAMPOFRIO': 'bg-red-950/50 text-red-300 border-red-800/40',
      'QUALIANZA': 'bg-emerald-950/50 text-emerald-300 border-emerald-800/40',
      'MASENS': 'bg-teal-950/50 text-teal-300 border-teal-800/40',
      'COCA-COLA': 'bg-red-950/50 text-red-300 border-red-800/40',
    };
    return colors[supplier] || 'bg-indigo-950/50 text-indigo-300 border-indigo-800/40';
  };

  return (
    <div className="bg-mesh min-h-screen flex flex-col antialiased">

      {/* Header */}
      <header className="glass-panel sticky top-0 z-40 border-b border-white/5 py-4 px-6 md:px-8 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/20 p-2 rounded-xl border border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
            <Layers className="w-6 h-6 text-indigo-400 animate-pulse-slow" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Divisor de Facturas PDF
            </h1>
            <p className="text-xs text-slate-400 hidden sm:block">Extrae facturas agrupadas automáticamente</p>
          </div>
        </div>
        {file && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 text-slate-300 transition duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Cargar otro archivo</span>
          </button>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col justify-center">

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/30 text-red-200 flex gap-3 items-start animate-fade-in shadow-lg">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold">Error al procesar archivo</h4>
              <p className="text-sm text-red-300">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* State 1: Upload Dropzone */}
        {!file && !isAnalyzing && (
          <div className="max-w-2xl w-full mx-auto py-12 animate-fade-in">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-extrabold text-white tracking-tight mb-3">
                ¿Facturas de varias páginas unidas en un solo PDF?
              </h2>
              <p className="text-slate-400 max-w-lg mx-auto">
                Sube tu PDF y nuestra herramienta inteligente detectará dónde empieza y termina cada factura basándose en el contenido de texto. Podrás ajustar los cortes con un solo clic.
              </p>
            </div>

            <div
              ref={dropRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-upload-input').click()}
              className={`glass-panel border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all duration-300 flex flex-col items-center group relative overflow-hidden ${isDragging
                  ? 'border-indigo-400 bg-indigo-950/10 shadow-[0_0_30px_rgba(99,102,241,0.15)]'
                  : 'border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-900/30 shadow-2xl'
                }`}
            >
              {/* Decorative Glow */}
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none group-hover:scale-150 transition duration-500"></div>

              <div className="bg-indigo-950/40 p-5 rounded-2xl border border-indigo-800/20 group-hover:scale-110 group-hover:border-indigo-500/30 transition duration-300 mb-6 shadow-inner">
                <Upload className="w-12 h-12 text-indigo-400 group-hover:text-indigo-300" />
              </div>

              <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-indigo-200 transition">
                Arrastra tu PDF aquí o haz clic para buscarlo
              </h3>
              <p className="text-sm text-slate-400 mb-4 max-w-xs">
                Soporta archivos de facturación consolidados (ej. facturas y albaranes combinados).
              </p>

              <span className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition duration-200 shadow-md group-hover:shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                Seleccionar PDF
              </span>

              <input
                id="file-upload-input"
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="mt-8 flex justify-center gap-6 text-xs text-slate-400 text-center">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-500" />
                <span>100% Seguro (Procesamiento local)</span>
              </div>
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-indigo-400" />
                <span>Conserva la calidad del documento original</span>
              </div>
            </div>
          </div>
        )}

        {/* State 2: Analyzing Loader */}
        {isAnalyzing && (
          <div className="max-w-md w-full mx-auto text-center py-20 animate-pulse-slow">
            <div className="relative w-24 h-24 mx-auto mb-8">
              {/* Spinning Ring */}
              <div className="absolute inset-0 rounded-full border-4 border-slate-800"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 border-r-indigo-400 animate-spin"></div>
              <FileText className="w-8 h-8 text-indigo-400 absolute inset-0 m-auto" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Analizando Estructura del PDF...</h3>
            <p className="text-slate-400 text-sm max-w-xs mx-auto mb-4">
              Leyendo contenido de texto para autodetectar proveedores y cambios de facturas.
            </p>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-indigo-500 h-full w-[65%] rounded-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* State 3: Workspace (Analyzing completed, no download generated yet) */}
        {file && pages.length > 0 && !downloadBlob && (
          <div className="flex flex-col lg:flex-row gap-6 items-stretch animate-fade-in">

            {/* Left Area: Visual Workspace (Pages Grid) */}
            <div className="flex-1 flex flex-col glass-panel rounded-2xl p-6 shadow-2xl relative overflow-hidden">

              {/* Workspace Header */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 pb-4 border-b border-white/5 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Mesa de Trabajo</span>
                    <span className="text-xs font-normal py-0.5 px-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                      {file.name}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Pulsa en las líneas de corte (verde) para dividir o unir facturas.
                  </p>
                </div>

                {/* Mode Selector */}
                <div className="flex p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setActiveTab('grid')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition duration-200 ${activeTab === 'grid'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    Mosaico
                  </button>
                  <button
                    onClick={() => setActiveTab('list')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition duration-200 ${activeTab === 'list'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    Detalle de Páginas
                  </button>
                </div>
              </div>

              {/* Progress of thumbnail generation */}
              {renderProgress < 100 && (
                <div className="mb-4 p-2 bg-indigo-950/20 border border-indigo-900/30 rounded-xl flex justify-between items-center text-xs text-indigo-300">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Generando miniaturas en segundo plano...
                  </span>
                  <span className="font-semibold">{renderProgress}%</span>
                </div>
              )}

              {/* View 1: Mosaico (Visual Grid) */}
              {activeTab === 'grid' && (
                <div className="flex-1 overflow-y-auto max-h-[60vh] pr-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-y-6 gap-x-4">
                  {pages.map((page, idx) => {
                    const isSplit = splitIndices.has(idx);
                    const isDropped = dropped.has(idx);
                    const invNo = pageToInvoiceNo[idx] || 0;

                    return (
                      <React.Fragment key={idx}>
                        {/* If this page starts a new split (and it's not the very first page), insert an interactive vertical/horizontal break before it */}
                        {idx > 0 && isSplit && (
                          <div className="col-span-full py-1 flex items-center gap-4">
                            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-emerald-500/30"></div>
                            <button
                              onClick={() => toggleSplit(idx)}
                              className="flex items-center gap-2 px-3 py-1 bg-emerald-950 border border-emerald-500/40 hover:bg-emerald-900 text-emerald-300 text-xs font-semibold rounded-full active-split-glow shadow-md hover:scale-105 transition"
                            >
                              <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Fin de factura anterior / Inicio de nueva</span>
                            </button>
                            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-emerald-500/30"></div>
                          </div>
                        )}

                        {/* Page Card */}
                        <div
                          style={{ borderLeft: `3px solid ${isDropped ? 'rgb(100 116 139)' : `hsl(${(invNo * 67) % 360} 70% 50%)`}` }}
                          className={`group rounded-xl p-3 flex flex-col border transition-all duration-300 relative ${isDropped
                              ? 'bg-slate-950/60 border-slate-800 opacity-45 grayscale'
                              : isSplit
                                ? 'bg-slate-900/40 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.08)]'
                                : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                            }`}
                        >
                          {/* Page Number Label + a qué factura pertenece */}
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                              Pág. {idx + 1}
                            </span>
                            {isDropped ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-slate-800 text-slate-400 border-slate-700">
                                Descartada
                              </span>
                            ) : (
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                                style={{
                                  color: `hsl(${(invNo * 67) % 360} 80% 75%)`,
                                  borderColor: `hsl(${(invNo * 67) % 360} 70% 45% / 0.5)`,
                                  backgroundColor: `hsl(${(invNo * 67) % 360} 70% 30% / 0.25)`,
                                }}
                              >
                                Factura #{invNo}{isSplit ? ' · inicio' : ''}
                              </span>
                            )}
                          </div>

                          {/* Thumbnail / Visual Preview */}
                          <div className="bg-slate-950 aspect-[3/4] rounded-lg overflow-hidden border border-white/5 relative flex items-center justify-center mb-3">
                            {thumbnails[idx] ? (
                              <img
                                src={thumbnails[idx]}
                                alt={`Page ${idx + 1}`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="text-center p-3 animate-pulse">
                                <FileText className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                                <span className="text-[10px] text-slate-600">Renderizando...</span>
                              </div>
                            )}

                            {/* Hover Actions overlay */}
                            <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover:opacity-100 transition duration-200 flex flex-col justify-end p-2 gap-1.5">
                              {/* Preview text */}
                              <p className="text-[9px] text-slate-400 line-clamp-4 leading-tight mb-auto text-left italic">
                                "{page.snippet || 'Sin texto extraíble'}"
                              </p>

                              <button
                                onClick={() => setPreviewPage({ index: idx, snippet: page.snippet })}
                                className="w-full py-1 text-[10px] bg-slate-800 hover:bg-slate-750 text-slate-200 rounded flex items-center justify-center gap-1 font-semibold"
                              >
                                <Eye className="w-3 h-3" /> Ver fragmento
                              </button>
                              <button
                                onClick={() => toggleDrop(idx)}
                                title={isDropped ? 'Volver a incluir esta hoja' : 'Descartar esta hoja: no saldrá en ningún PDF'}
                                className={`w-full py-1 text-[10px] rounded flex items-center justify-center gap-1 font-semibold ${isDropped
                                    ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-100'
                                    : 'bg-red-900/70 hover:bg-red-800 text-red-100'
                                  }`}
                              >
                                {isDropped
                                  ? <><Undo2 className="w-3 h-3" /> Recuperar hoja</>
                                  : <><Trash2 className="w-3 h-3" /> Descartar hoja</>}
                              </button>
                            </div>
                          </div>

                          {/* Detected Metadata */}
                          <div className="mt-auto space-y-1">
                            {isDropped && (
                              <button
                                onClick={() => toggleDrop(idx)}
                                className="w-full text-[10px] font-bold py-1 rounded border bg-slate-800 text-slate-300 border-slate-700 hover:bg-emerald-900/60 hover:text-emerald-200 hover:border-emerald-700 flex items-center justify-center gap-1"
                              >
                                <Undo2 className="w-3 h-3" /> Recuperar hoja
                              </button>
                            )}
                            <span className={`block text-[10px] px-1.5 py-0.5 text-center font-semibold rounded border overflow-hidden text-ellipsis whitespace-nowrap ${getSupplierColorClass(page.supplier !== 'DESCONOCIDO' ? page.supplier : null)}`}>
                              {page.supplier !== 'DESCONOCIDO' ? page.supplier : 'PROV. NO DETECTADO'}
                            </span>
                            <span className="block text-[10px] text-center text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap">
                              Nº: {page.document_number || 'No detectado'}
                            </span>
                            {page.page_x && (
                              <span className="block text-[9px] text-center text-slate-500">
                                Página {page.page_x} de {page.page_y}
                              </span>
                            )}
                            {page.duplicate && (
                              <div className="text-center">
                                <span title={page.review} className="block text-[9px] font-bold text-red-300 bg-red-950/40 border border-red-800/40 rounded py-0.5 cursor-help">
                                  DUPLICADA
                                </span>
                                {page.review && (
                                  <span className="block text-[8px] text-red-400 mt-1 leading-tight break-words">
                                    {page.review.replace("Posible duplicado de la ", "")}
                                  </span>
                                )}
                              </div>
                            )}
                            {page.review && !page.duplicate && (
                              <span title={page.review} className="block text-[9px] text-center text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded py-0.5 truncate">
                                ⚠ Revisar
                              </span>
                            )}
                            {reassign[idx] !== undefined && (
                              <span className="block text-[9px] text-center font-semibold text-violet-300 bg-violet-950/40 border border-violet-800/40 rounded py-0.5">
                                → Movida a Factura #{pageToInvoiceNo[idx]}
                              </span>
                            )}
                            {/* Mover esta página a otra factura (agrupar no contiguas) */}
                            {invoiceGroups.length > 1 && !isDropped && pageOwnerStart[idx] !== undefined && (
                              <select
                                value={pageOwnerStart[idx]}
                                onChange={(e) => moveTo(idx, e.target.value)}
                                title="Mover esta página a otra factura"
                                className="w-full text-[9px] bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-300 focus:outline-none focus:border-violet-500 cursor-pointer"
                              >
                                {invoiceGroups.map((g, gi) => (
                                  <option key={g.startIdx} value={g.startIdx}>
                                    {invoiceLabel(g, gi)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          {/* Action Hover Button to split at this page */}
                          {idx > 0 && !isSplit && (
                            <button
                              onClick={() => toggleSplit(idx)}
                              className="absolute -bottom-2 -left-2 bg-slate-800 hover:bg-emerald-600 border border-slate-700 hover:border-emerald-500 rounded-full p-1.5 text-slate-400 hover:text-white shadow-lg opacity-0 group-hover:opacity-100 transition transform hover:scale-110 duration-200"
                              title="Convertir esta página en el inicio de una factura"
                            >
                              <Scissors className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {idx > 0 && isSplit && (
                            <button
                              onClick={() => toggleSplit(idx)}
                              className="absolute -bottom-2 -left-2 bg-emerald-600 hover:bg-slate-800 border border-emerald-500 hover:border-slate-700 rounded-full p-1.5 text-white hover:text-slate-400 shadow-lg transition transform hover:scale-110 duration-200"
                              title="Unir con la factura anterior"
                            >
                              <Merge className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}

              {/* View 2: Detalle de Páginas (List View) */}
              {activeTab === 'list' && (
                <div className="flex-1 overflow-y-auto max-h-[60vh] pr-2 space-y-2">
                  {pages.map((page, idx) => {
                    const isSplit = splitIndices.has(idx);
                    const isDropped = dropped.has(idx);

                    return (
                      <div
                        key={idx}
                        className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border transition-all ${isDropped
                            ? 'bg-slate-950/50 border-slate-850 opacity-50'
                            : isSplit
                              ? 'bg-indigo-950/15 border-indigo-500/30'
                              : 'bg-slate-900/30 border-slate-800/80 hover:bg-slate-900/50'
                          }`}
                      >
                        <div className="flex items-center gap-4">
                          <span className={`text-sm font-bold ${isDropped ? 'text-slate-600 line-through' : 'text-slate-400'}`}>Pág. {idx + 1}</span>
                          {isDropped && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-800 text-slate-400 border-slate-700">
                              Descartada
                            </span>
                          )}
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${getSupplierColorClass(page.supplier !== 'DESCONOCIDO' ? page.supplier : null)}`}>
                            {page.supplier !== 'DESCONOCIDO' ? page.supplier : 'Proveedor no detectado'}
                          </span>
                          <span className="text-xs text-slate-400">
                            Nº: <strong className="text-slate-200">{page.document_number || 'N/A'}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-3 sm:mt-0 w-full sm:w-auto justify-end">
                          <p className="text-xs text-slate-500 italic max-w-xs truncate hidden md:block">
                            "{page.snippet}"
                          </p>

                          {idx > 0 && !isDropped && (
                            <button
                              onClick={() => toggleSplit(idx)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${isSplit
                                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750'
                                }`}
                            >
                              {isSplit ? (
                                <>
                                  <Merge className="w-3.5 h-3.5 text-indigo-400" />
                                  <span>Deshacer Corte</span>
                                </>
                              ) : (
                                <>
                                  <Scissors className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Iniciar Factura aquí</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => toggleDrop(idx)}
                            title={isDropped ? 'Volver a incluir esta hoja' : 'Descartar esta hoja: no saldrá en ningún PDF'}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border ${isDropped
                                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40 hover:bg-emerald-900/40'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-red-950/60 hover:text-red-300 hover:border-red-800/50'
                              }`}
                          >
                            {isDropped ? (
                              <><Undo2 className="w-3.5 h-3.5" /><span>Recuperar</span></>
                            ) : (
                              <><Trash2 className="w-3.5 h-3.5" /><span>Descartar</span></>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Area: Sidebar Summary & Split Action */}
            <div className="w-full lg:w-96 flex flex-col gap-6">

              {/* Summary Card */}
              <div className="glass-panel rounded-2xl p-6 shadow-2xl flex flex-col h-full max-h-[70vh]">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 pb-3 border-b border-white/5">
                  <FileCheck className="w-5 h-5 text-indigo-400" />
                  Resumen de Facturas
                </h3>

                {/* List of files to be generated */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-3 mb-6">
                  {invoiceGroups.map((group, idx) => {
                    const supplierName = group.supplier ? group.supplier : 'Proveedor';
                    const docNum = group.document_number ? group.document_number : 'S/N';
                    const isExcluded = excluded.has(group.startIdx);

                    return (
                      <div
                        key={idx}
                        className={`p-3 border rounded-xl transition flex items-start gap-3 ${isExcluded
                            ? 'bg-slate-900/30 border-slate-850 opacity-50'
                            : group.duplicate
                              ? 'bg-red-950/15 border-red-900/40'
                              : group.review
                                ? 'bg-amber-950/10 border-amber-900/40'
                                : 'bg-slate-900/60 border-slate-850 hover:border-slate-800'
                          }`}
                      >
                        <div className="bg-indigo-950 text-indigo-300 border border-indigo-800/20 px-2.5 py-1 rounded-lg text-xs font-bold font-mono">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap ${isExcluded ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                            {supplierName}
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Doc: {docNum}
                          </p>
                          {/* Distintivos de triaje */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {group.duplicate && (
                              <span className="text-[9px] font-bold bg-red-950/50 text-red-300 border border-red-800/40 px-1.5 py-0.5 rounded">DUPLICADA</span>
                            )}
                            {group.review && (
                              <span title={group.review} className="text-[9px] bg-amber-950/40 text-amber-300 border border-amber-800/40 px-1.5 py-0.5 rounded truncate max-w-[180px]">⚠ {group.review}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-medium">
                              Páginas: {group.pages.map(p => p + 1).join(', ')}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              ({group.pages.length} {group.pages.length === 1 ? 'pág' : 'págs'})
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleExclude(group.startIdx)}
                          title={isExcluded ? 'Incluir en el ZIP' : 'Excluir del ZIP'}
                          className={`shrink-0 text-[10px] px-2 py-1 rounded-lg border transition ${isExcluded
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40 hover:bg-emerald-900/40'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                            }`}
                        >
                          {isExcluded ? 'Incluir' : 'Excluir'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Confirm actions */}
                <div className="mt-auto space-y-3 pt-4 border-t border-white/5">
                  <div className="flex justify-between items-center text-sm text-slate-300">
                    <span>Facturas a generar:</span>
                    <span className="font-bold text-white text-base">{includedGroups.length}</span>
                  </div>
                  {(duplicateCount > 0 || reviewCount > 0) && (
                    <div className="text-[11px] text-slate-400 -mt-1 mb-1 space-y-0.5">
                      {duplicateCount > 0 && (
                        <div className="flex justify-between"><span className="text-red-300">Duplicadas (excluidas)</span><span>{duplicateCount}</span></div>
                      )}
                      {reviewCount > 0 && (
                        <div className="flex justify-between"><span className="text-amber-300">A revisar</span><span>{reviewCount}</span></div>
                      )}
                    </div>
                  )}
                  {droppedCount > 0 && (
                    <div className="flex justify-between text-[11px] text-slate-400 -mt-1 mb-1">
                      <span className="text-slate-300">Hojas descartadas</span>
                      <span>{droppedCount}</span>
                    </div>
                  )}

                  <button
                    onClick={handleSplitPdf}
                    disabled={isSplitting || includedGroups.length === 0}
                    className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition duration-200 shadow-lg hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] disabled:opacity-50"
                  >
                    {isSplitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generando ZIP...</span>
                      </>
                    ) : (
                      <>
                        <Scissors className="w-4 h-4" />
                        <span>Confirmar y Dividir</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* State 4: Success, ZIP Ready to Download */}
        {downloadBlob && (
          <div className="max-w-xl w-full mx-auto glass-panel rounded-3xl p-8 text-center shadow-2xl animate-scale-up relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="bg-emerald-950/30 p-5 rounded-full border border-emerald-500/20 inline-block mb-6 shadow-inner animate-bounce-slow">
              <CheckCircle className="w-16 h-16 text-emerald-400" />
            </div>

            <h2 className="text-2xl font-extrabold text-white mb-2">¡División Completada con Éxito!</h2>
            <p className="text-slate-400 text-sm max-w-sm mx-auto mb-6">
              Hemos dividido tu PDF en <strong>{includedGroups.length} facturas</strong> independientes. Todo el lote está empaquetado en un archivo ZIP listo para descargar.
            </p>

            {/* File list preview */}
            <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl text-left max-h-48 overflow-y-auto mb-8 space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Archivos dentro del ZIP:</h4>
              {includedGroups.map((g, idx) => {
                const supplierName = g.supplier ? g.supplier.replace(/\s+/g, '_') : 'DOCUMENTO';
                const docNum = g.document_number ? g.document_number.replace(/[\/\s]+/g, '-') : 'S-N';
                const numStr = String(idx + 1).padStart(2, '0');

                return (
                  <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-white/5 last:border-0">
                    <span className="text-slate-300 font-mono truncate max-w-xs sm:max-w-sm">
                      {numStr}_{supplierName}_{docNum}.pdf
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium shrink-0">
                      ({g.pages.length} {g.pages.length === 1 ? 'pág' : 'págs'})
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleDownloadZip}
                className="flex-1 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition duration-200 shadow-lg hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              >
                <Download className="w-5 h-5" />
                Descargar ZIP
              </button>

              <button
                onClick={handleReset}
                className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 font-bold rounded-xl text-sm transition duration-200"
              >
                Volver a empezar
              </button>
            </div>
          </div>
        )}

      </main>

      {/* Floating Preview Modal */}
      {previewPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/5">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                Contenido de Texto - Página {previewPage.index + 1}
              </h4>
              <button
                onClick={() => setPreviewPage(null)}
                className="text-slate-400 hover:text-white text-xs font-semibold px-2.5 py-1 bg-slate-800 hover:bg-slate-750 rounded-lg transition"
              >
                Cerrar
              </button>
            </div>
            <div className="bg-slate-950/50 border border-white/5 rounded-xl p-4 max-h-60 overflow-y-auto text-xs leading-relaxed text-slate-300 font-mono whitespace-pre-wrap text-left">
              {previewPage.snippet || 'Sin contenido de texto extraído.'}
            </div>
            <p className="text-[10px] text-slate-500 mt-3 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              Este fragmento es utilizado por el sistema para detectar proveedores y números de facturas.
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 px-6 text-center text-xs text-slate-500 border-t border-white/5 glass-panel mt-auto">
        <p>© 2026 Divisor de Facturas PDF - Desarrollado para automatizar la contabilidad</p>
      </footer>
    </div>
  );
}
