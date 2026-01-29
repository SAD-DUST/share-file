// ==UserScript==
// @name         OLM Suite
// @namespace    http://tampermonkey.net/
// @version      5.14
// @description  Nothing but good
// @author       SAD_DUST
// @match        https://olm.vn/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- GLOBAL STATE ---
    let bypassBlock = false;
    let allQuestions = [];
    let isAutoSolve = false;
    let mutationObserver = null;
    let isProcessing = false;
    let uiContainer = null;

    // ==========================================
    // MATH RENDERING HELPER
    // ==========================================
    function renderLatexToText(latex) {
        if (!latex) return "";
        return latex
            .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
            .replace(/\\pi/g, 'π')
            .replace(/\\omega/g, 'ω')
            .replace(/\\lambda/g, 'λ')
            .replace(/\\mu/g, 'μ')
            .replace(/\\alpha/g, 'α')
            .replace(/\\beta/g, 'β')
            .replace(/\\gamma/g, 'γ')
            .replace(/\\Delta/g, 'Δ')
            .replace(/\\varphi/g, 'φ')
            .replace(/\\theta/g, 'θ')
            .replace(/\^\{([^}]+)\}/g, '^$1')
            .replace(/_\{([^}]+)\}/g, '_$1')
            .replace(/\\left|\\right/g, '')
            .replace(/\\/g, '')
            .trim();
    }

    // ==========================================
    // 1. NETWORK SNIFFER (Fetch + XHR)
    // ==========================================
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    window.fetch = function(...args) {
        const url = args[0];
        return originalFetch.apply(this, args).then(async (response) => {
            if (typeof url === 'string' && url.includes('get-question-of-ids')) {
                try {
                    const data = await response.clone().json();
                    processCapturedData(data);
                } catch (e) { console.error('[OLM] Fetch parse error:', e); }
            }
            return response;
        });
    };

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        if (this._url && this._url.includes('get-question-of-ids')) {
            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    processCapturedData(data);
                } catch (e) { console.error('[OLM] XHR parse error:', e); }
            });
        }
        return originalSend.apply(this, arguments);
    };

    function processCapturedData(data) {
        console.log("%c[OLM Sniffer] ✅ Data Captured!", "color: #0a0; font-weight: bold;");
        allQuestions = parseQuestions(data);
        renderAnswers(allQuestions);
        if (isAutoSolve) {
            setTimeout(solveCurrentQuestion, 100);
        }
    }

    // ==========================================
    // 2. ROBUST PARSING LOGIC
    // ==========================================
    function parseQuestions(dataArray) {
        if (!Array.isArray(dataArray)) return [];
        return dataArray.map(q => {
            const id = q.id || q.old_id;
            const title = q.title || "Unknown";
            const level = q._level?.short_label || "N/A";
            let questionText = "";
            let options = [];

            try {
                const contentStruct = JSON.parse(q.json_content);
                const root = contentStruct.root;

                if (root && root.children) {
                    // 1. Extract Question Text
                    const qNode = root.children.find(c => c.type === 'paragraph');
                    if (qNode) questionText = extractTextWithMath(qNode);

                    // 2. Try to find standard list options
                    const listNode = root.children.find(c =>
                        c.type === 'olm-list' || c.name === 'quiz-list'
                    );

                    if (listNode && listNode.children) {
                        listNode.children.forEach(opt => {
                            if (opt.type === 'olm-list-item' || opt.type === 'quiz-item') {
                                const text = extractTextWithMath(opt);
                                const latex = extractLatex(opt);
                                let isCorrect = opt.correct === true;
                                options.push({ text, latex, isCorrect });
                            }
                        });
                    }

                    // 3. LOGIC FOR NON-MULTIPLE CHOICE (Type 12, 13) or Empty Options
                    const qType = parseInt(q.q_type);
                    const isNonMultiChoice = [12, 13].includes(qType);

                    if (isNonMultiChoice || options.length === 0) {
                        const expText = getExplanationText(root);

                        if (expText) {
                            options = [{
                                text: "📝 Solution/Explanation:\n" + expText,
                                latex: "",
                                isCorrect: true
                            }];
                        } else {
                            const fallbackAnswer = findAnswerInParagraphs(root);
                            if (fallbackAnswer) {
                                options.push({ text: fallbackAnswer, latex: "", isCorrect: true });
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("[OLM] Parse error:", title, e);
            }

            return { id, title, level, questionText, options };
        });
    }

    function findAnswerInParagraphs(node) {
        if (!node) return null;
        if (node.children) {
            for (let child of node.children) {
                if (child.type === 'paragraph') {
                    const text = extractTextWithMath(child);
                    const match = text.match(/Trả lời:\s*\[([^\]]+)\]/i);
                    if (match && match[1]) return match[1].trim();
                }
                const res = findAnswerInParagraphs(child);
                if (res) return res;
            }
        }
        return null;
    }

    function extractTextWithMath(node) {
        if (!node) return "";
        if (node.text && typeof node.text === 'string') return node.text;
        if (!node.children || !Array.isArray(node.children)) return "";

        return node.children.map(child => {
            if (child.type === 'text' || child.type === 'extended-text') return child.text || "";
            if (child.type === 'equation') return renderLatexToText(child.equation || child.latex_mathtype || "");
            if (child.children) return extractTextWithMath(child);
            return "";
        }).join(" ").replace(/\s+/g, ' ').trim();
    }

    function extractLatex(node) {
        if (!node || !node.children) return "";
        return node.children.map(child => {
            if (child.type === 'equation') return child.equation || child.latex_mathtype || "";
            if (child.children) return extractLatex(child);
            return "";
        }).filter(Boolean).join(" ");
    }

    // ==========================================
    // 3. UTILITIES & LOGIC
    // ==========================================

    async function copy(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (e) { console.warn('[OLM] Clipboard API failed, using fallback'); }
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            ta.remove();
            return true;
        } catch (e) {
            ta.remove();
            return false;
        }
    }

    async function getWordLink() {
        const m = location.pathname.match(/(\d+)$/);
        if (!m) throw new Error('No ID found in URL');
        const id = m[1];
        const api = `https://olm.vn/download-word-for-user?id_cate=${id}&showAns=1&questionNotApproved=0`;
        const r = await fetch(api);
        if (!r.ok) throw new Error('Server Error: ' + r.status);
        const j = await r.json();
        if (!j?.file) throw new Error('No File Link in response');
        return j.file;
    }

    const blockHandler = (e) => {
        if (bypassBlock) return;
        e.stopImmediatePropagation();
        e.preventDefault();
    };

    function toggleAntiCheat(enable) {
        // --- 1. EXAM FINISH BLOCK ---
        if (enable) {
            window.addEventListener('forceFinishExam', blockHandler, true);
            window.addEventListener('finishExam', blockHandler, true);
            document.addEventListener('visibilitychange', blockHandler, true);
            window.addEventListener('blur', blockHandler, true);
            window.addEventListener('focus', blockHandler, true);
            if (typeof EXAM_UI !== 'undefined') EXAM_UI.setData('count_log', 0);
        } else {
            window.removeEventListener('forceFinishExam', blockHandler, true);
            window.removeEventListener('finishExam', blockHandler, true);
            document.removeEventListener('visibilitychange', blockHandler, true);
            window.removeEventListener('blur', blockHandler, true);
            window.removeEventListener('focus', blockHandler, true);
        }

        // --- 2. MANUAL FORCE COPY (UPDATED) ---
        let styleTag = document.getElementById('olm-copy-bypass-css');
        if (enable) {
            // 1. Force CSS for Selection
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'olm-copy-bypass-css';
                styleTag.innerHTML = `
                    * {
                        user-select: text !important;
                        -webkit-user-select: text !important;
                        -moz-user-select: text !important;
                        -ms-user-select: text !important;
                    }
                `;
                document.head.appendChild(styleTag);
            }
            document.body.style.userSelect = "auto";

            // 2. Manual Copy Handler
            window._olmBypassKeyHandler = (e) => {
                const k = e.key.toLowerCase();
                const isCtrl = e.ctrlKey || e.metaKey;

                // --- FORCE COPY ---
                if (isCtrl && k === 'c') {
                    // Stop event completely so site never sees it
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    e.preventDefault();

                    // Get text manually
                    const activeEl = document.activeElement;
                    let textToCopy = "";

                    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                        // Handle Input/Textarea selection
                        const s = activeEl.selectionStart;
                        const en = activeEl.selectionEnd;
                        textToCopy = activeEl.value.substring(s, en);
                    } else {
                        // Handle body text selection
                        const selection = window.getSelection();
                        textToCopy = selection.toString();
                    }

                    // Manual Write to Clipboard
                    if (textToCopy && textToCopy.length > 0) {
                        const doCopy = async (text) => {
                            try {
                                await navigator.clipboard.writeText(text);
                                console.log("[OLM] Manual Copy Success:", text.substring(0, 20) + "...");
                                // Visual Feedback
                                if (window._toastbox) window._toastbox("Copied!");
                            } catch (err) {
                                console.error("[OLM] Manual Copy Failed", err);
                                // Fallback for HTTP
                                const ta = document.createElement('textarea');
                                ta.value = text;
                                ta.style.position = 'fixed';
                                ta.style.left = '-9999px';
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                ta.remove();
                                if (window._toastbox) window._toastbox("Copied (Fallback)!");
                            }
                        };
                        doCopy(textToCopy);
                    }
                    return;
                }

                // --- ALLOW PASTE (Ctrl+V) ---
                if (isCtrl && k === 'v') {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    // Do not preventDefault, let browser paste
                    return;
                }

                // --- ALLOW SELECT ALL (Ctrl+A) ---
                if (isCtrl && k === 'a') {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    // Do not preventDefault
                    return;
                }

                // --- ALLOW DEVTOOLS / ETC ---
                if (e.key === 'F12' || (isCtrl && ['f', 'u'].includes(k))) {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    return;
                }
            };

            // Capture phase
            window.addEventListener('keydown', window._olmBypassKeyHandler, true);

            // Allow Right Click
            window._olmBypassCtxHandler = (e) => {
                e.stopImmediatePropagation();
                e.stopPropagation();
            };
            window.addEventListener('contextmenu', window._olmBypassCtxHandler, true);

            // Clear inline handlers
            document.oncontextmenu = null;
            document.oncopy = null;
            document.onpaste = null;
            document.oncut = null;
            document.onkeydown = null;

        } else {
            if (styleTag) styleTag.remove();
            if (window._olmBypassKeyHandler) window.removeEventListener('keydown', window._olmBypassKeyHandler, true);
            if (window._olmBypassCtxHandler) window.removeEventListener('contextmenu', window._olmBypassCtxHandler, true);
        }
    }

    function toggleSubmitBlock(enable) {
        if (enable) {
            window.addEventListener('forceFinishExam', blockHandler, true);
            window.addEventListener('finishExam', blockHandler, true);
        } else {
            window.removeEventListener('forceFinishExam', blockHandler, true);
            window.removeEventListener('finishExam', blockHandler, true);
        }
    }

    function toggleReviewMode(enable) {
        if (typeof EXAM_UI !== 'undefined') {
            EXAM_UI.setData('done_exam', enable ? 1 : 0);
            if (enable) {
                const activeItem = document.querySelector(".item-q.active");
                if (activeItem) activeItem.click();
            }
        }
        // --- SHOW REFRESH BUTTON IF TURNED OFF ---
        if (!enable) {
            showRefreshButton();
        } else {
            hideRefreshButton();
        }
    }

    function toggleFreezeTime(enable) {
        if (typeof CATE_UI !== 'undefined' && typeof CATE_UI.timestop === 'function') {
            if (enable) CATE_UI.timestop();
        }
        // --- SHOW REFRESH BUTTON IF TURNED OFF ---
        if (!enable) {
            showRefreshButton();
        } else {
            hideRefreshButton();
        }
    }

    // --- REFRESH BUTTON LOGIC ---
    function showRefreshButton() {
        const btn = document.getElementById('olm-refresh-btn');
        if (btn) btn.style.display = 'flex';
    }

    function hideRefreshButton() {
        const btn = document.getElementById('olm-refresh-btn');
        if (btn) btn.style.display = 'none';
    }

    function forceFinish() {
        bypassBlock = true;
        document.dispatchEvent(new CustomEvent("forceFinishExam"));
        setTimeout(() => { bypassBlock = false; }, 50);
    }

    // ==========================================
    // 4. ROBUST AUTO-SOLVE (LOOP FIX)
    // ==========================================
    function solveCurrentQuestion() {
        if (!isAutoSolve || isProcessing) return;
        isProcessing = true;

        try {
            const questions = Array.from(document.querySelectorAll('.quizx.question-hold'));
            const activeQuestion = questions.find(el => {
                if (el.style.display === 'none') return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            });

            if (!activeQuestion) return;
            const quizContent = activeQuestion.querySelector('.quiz-content');
            if (!quizContent) return;
            const quizId = quizContent.getAttribute('data-id-quiz');
            if (!quizId) return;

            const qData = allQuestions.find(q => String(q.id) === String(quizId));
            if (!qData) return;
            const correctOption = qData.options.find(opt => opt.isCorrect);
            if (!correctOption) return;

            const domOptions = activeQuestion.querySelectorAll('.qselect');
            const normalize = (str) => {
                if (!str) return "";
                const txt = document.createElement("textarea");
                txt.innerHTML = str;
                const decoded = txt.value;
                return decoded.toLowerCase()
                          .replace(/\s+/g, ' ')
                          .replace(/&nbsp;/g, ' ')
                          .replace(/\n/g, ' ')
                          .replace(/[^\w\s\+\-\=\(\)\/\.\,]/g, '')
                          .trim();
            };

            const targetClean = normalize(correctOption.text);
            const targetLatex = correctOption.latex || "";

            const currentlyChecked = activeQuestion.querySelector('.qselect.qchecked');
            if (currentlyChecked) {
                const checkedText = normalize(currentlyChecked.querySelector('.qsign')?.innerText);
                const checkedLatex = Array.from(currentlyChecked.querySelectorAll('.katex-mathml annotation'))
                                         .map(el => el.textContent).join(" ");
                if (checkedText === targetClean ||
                    (targetLatex && checkedLatex.includes(targetLatex))) {
                    return;
                }
            }

            let bestOption = null;
            let highestScore = 0;

            domOptions.forEach((opt) => {
                const optSign = opt.querySelector('.qsign');
                if (!optSign) return;

                const domText = optSign.innerText || optSign.textContent || "";
                const katexElements = optSign.querySelectorAll('.katex-mathml annotation');
                const latexInDom = Array.from(katexElements).map(el => el.textContent).join(" ");
                const domClean = normalize(domText);

                let score = 0;

                if (domClean === targetClean) score = 100;
                else if (targetLatex && latexInDom && latexInDom.includes(targetLatex)) score = 95;
                else if (targetClean.length > 5 && domClean.includes(targetClean)) score = 80;
                else if (domClean.length > 5 && targetClean.includes(domClean)) score = 70;
                else if (levenshteinDistance(domClean, targetClean) <= 1) score = 60;
                else if (levenshteinDistance(domClean, targetClean) <= 2) score = 40;
                else if (levenshteinDistance(domClean, targetClean) <= 3) score = 20;

                if (domClean.length < 4 && score < 100) score = 0;

                if (score > highestScore) {
                    highestScore = score;
                    bestOption = opt;
                }
            });

            if (highestScore > 75 && bestOption) {
                if (!bestOption.classList.contains('qchecked')) {
                    bestOption.click();
                }
            }
        } finally {
            setTimeout(() => { isProcessing = false; }, 50);
        }
    }

    function levenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
                else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
        return matrix[b.length][a.length];
    }

    // ==========================================
    // 5. UI GENERATION & PERSISTENCE
    // ==========================================
    function createUI() {
        uiContainer = document.createElement('div');
        uiContainer.id = 'olm-v3-container';
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            #olm-v3-container {
                position: fixed; top: 100px; right: 30px; width: 380px; max-height: 80vh;
                background: rgba(20, 20, 25, 0.98);
                border: 1px solid rgba(255,255,255,0.2); border-radius: 12px;
                box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8); color: #fff;
                font-family: 'Inter', sans-serif; z-index: 2147483647; display: flex; flex-direction: column;
                transition: opacity 0.2s;
            }
            #olm-v3-container.minimized { width: auto; height: auto; max-height: none; overflow: visible; }
            #olm-v3-container.minimized #olm-body, #olm-v3-container.minimized .olm-tabs { display: none; }
            #olm-v3-container.minimized #olm-header { padding: 10px 15px; border-radius: 12px; }
            #olm-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; border-radius: 12px 12px 0 0; }
            #olm-title { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; pointer-events: none; }
            .btn-minimize { background: rgba(255,255,255,0.2); border: none; color: white; font-size: 18px; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
            .btn-minimize:hover { background: rgba(255,255,255,0.3); }
            .olm-tabs { display: flex; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1); }
            .olm-tab-btn { flex: 1; background: transparent; border: none; color: #8b9bb4; padding: 12px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s; }
            .olm-tab-btn.active { color: #fff; background: rgba(255,255,255,0.1); border-bottom: 2px solid #667eea; }
            #olm-body { padding: 15px; overflow-y: auto; min-height: 100px; }
            .tab-content { display: none; } .tab-content.active { display: block; animation: fadeIn 0.3s; }
            .olm-row { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; margin-bottom: 8px; }
            .olm-label { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; pointer-events: auto; }
            .switch { position: relative; width: 40px; height: 22px; flex-shrink: 0; } .switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 34px; pointer-events: auto; }
            .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .slider { background: #667eea; } input:checked + .slider:before { transform: translateX(18px); }
            .olm-btn { width: 100%; padding: 10px; border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.1s; }
            .olm-btn:active { transform: scale(0.98); } .btn-get { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
            .btn-force { background: linear-gradient(135deg, #cb2d3e 0%, #ef473a 100%); }
            #search-input { width: 100%; padding: 10px; margin-bottom: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; font-family: inherit; box-sizing: border-box; }
            #search-input:focus { outline: none; border-color: #667eea; }
            #answers-list { display: flex; flex-direction: column; gap: 12px; }
            .ans-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; font-size: 13px; }
            .ans-q-title { color: #667eea; font-weight: 700; margin-bottom: 4px; }
            .ans-q-text { margin-bottom: 8px; line-height: 1.4; color: #ddd; }
            .ans-options { list-style: none; padding: 0; margin: 0; }
            .ans-opt {
                padding: 8px;
                margin-bottom: 2px;
                border-radius: 4px;
                font-size: 13px;
                white-space: pre-wrap;
                line-height: 1.6;
                word-wrap: break-word;
            }
            .ans-opt.correct { background: rgba(56, 239, 125, 0.1); color: #38ef7d; font-weight: 600; border: 1px solid rgba(56, 239, 125, 0.3); }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

            /* Refresh Button Styles */
            #olm-refresh-btn {
                position: fixed; left: 30px; top: 100px;
                background: rgba(255, 193, 7, 0.95); /* Amber Warning */
                color: #000; padding: 12px 20px; border-radius: 8px;
                cursor: pointer; z-index: 2147483646; display: none;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                font-weight: 600; font-family: 'Inter', sans-serif;
                align-items: center; gap: 8px; transition: transform 0.1s;
                border: 2px solid #fff;
            }
            #olm-refresh-btn:hover { transform: scale(1.05); background: rgba(255, 165, 0, 0.95); }
        `;
        document.head.appendChild(style);

        uiContainer.innerHTML = `
            <div id="olm-header"><div id="olm-title"><span>🔮 OLM v5.14 (Smart Parser)</span></div><button id="btn-minimize" class="btn-minimize">_</button></div>
            <div class="olm-tabs"><button class="olm-tab-btn active" data-tab="tools">Tools</button><button class="olm-tab-btn" data-tab="answers">Answers</button></div>
            <div id="olm-body">
                <div id="tab-tools" class="tab-content active">
                    <div class="olm-row"><div class="olm-label">🛡️ Anti-AC</div><label class="switch"><input type="checkbox" id="chk-anticheat"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">🚫 Block Submit</div><label class="switch"><input type="checkbox" id="chk-block"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">👁 Review Mode</div><label class="switch"><input type="checkbox" id="chk-review"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">⏳ Freeze Time</div><label class="switch"><input type="checkbox" id="chk-freeze"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">🤖 Auto-Solve</div><label class="switch"><input type="checkbox" id="chk-autosolve"><span class="slider"></span></label></div>
                    <button id="btn-get-file" class="olm-btn btn-get"><span>📄</span> Get File Link</button>
                    <button id="btn-force-submit" class="olm-btn btn-force"><span>⚠</span> Force Finish</button>
                </div>
                <div id="tab-answers" class="tab-content"><input type="text" id="search-input" placeholder="🔍 Search questions..."><div id="answers-list"><div class="empty-state">Waiting for sniffer...</div></div></div>
            </div>
        `;

        document.body.appendChild(uiContainer);
        setupDrag(uiContainer, document.getElementById('olm-header'));
        setupUIEvents();
        setupMutationObserver();
        setupUIPersistence();

        // --- CREATE REFRESH BUTTON ---
        const refreshBtn = document.createElement('div');
        refreshBtn.id = 'olm-refresh-btn';
        refreshBtn.innerHTML = '⚠ Refresh Required';
        refreshBtn.addEventListener('click', () => location.reload());
        document.body.appendChild(refreshBtn);

        setTimeout(() => {
            const chk = uiContainer.querySelector('#chk-anticheat');
            if(chk && !chk.checked) {
                chk.click();
            }
        }, 500);
    }

    function setupUIPersistence() {
        const observer = new MutationObserver((mutations) => {
            // Restore Main UI
            if (uiContainer && document.body && !document.body.contains(uiContainer)) {
                console.log("%c[OLM] UI was removed, restoring...", "color: #f0f; font-weight: bold;");
                document.body.appendChild(uiContainer);
            }
            // Restore Refresh Button
            const refreshBtn = document.getElementById('olm-refresh-btn');
            if (refreshBtn && document.body && !document.body.contains(refreshBtn)) {
                document.body.appendChild(refreshBtn);
            }
        });

        if (document.body) {
            observer.observe(document.body, { childList: true });
        }
    }

    function switchTab(tabName) {
        document.querySelectorAll('.olm-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const targetBtn = uiContainer.querySelector(`.olm-tab-btn[data-tab="${tabName}"]`);
        const targetContent = uiContainer.querySelector(`#tab-${tabName}`);
        if (targetBtn) targetBtn.classList.add('active');
        if (targetContent) targetContent.classList.add('active');
    }

    function setupUIEvents() {
        uiContainer.querySelectorAll('.olm-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
        });
        uiContainer.getElementById = (id) => uiContainer.querySelector(`#${id}`);

        uiContainer.querySelector('#chk-anticheat').addEventListener('change', (e) => toggleAntiCheat(e.target.checked));
        uiContainer.querySelector('#chk-block').addEventListener('change', (e) => toggleSubmitBlock(e.target.checked));
        uiContainer.querySelector('#chk-review').addEventListener('change', (e) => toggleReviewMode(e.target.checked));
        uiContainer.querySelector('#chk-freeze').addEventListener('change', (e) => toggleFreezeTime(e.target.checked));

        uiContainer.querySelector('#chk-autosolve').addEventListener('change', (e) => {
            isAutoSolve = e.target.checked;
            if (isAutoSolve) { console.log("%c[Auto-Solve] ENABLED", "color: #f093fb; font-weight: bold;"); setTimeout(solveCurrentQuestion, 100); }
        });

        uiContainer.querySelector('#btn-minimize').addEventListener('click', (e) => {
            e.stopPropagation(); uiContainer.classList.toggle('minimized');
        });

        uiContainer.querySelector('#btn-get-file').addEventListener('click', async () => {
            const btn = uiContainer.querySelector('#btn-get-file');
            const orig = btn.innerHTML;
            btn.innerHTML = '<span>⏳</span> Fetching...'; btn.disabled = true;
            try {
                const link = await getWordLink();
                const success = await copy(link);
                btn.innerHTML = success ? '<span>✅</span> Copied!' : '<span>⚠</span> Manual Copy';
                setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 3000);
            } catch (err) {
                btn.innerHTML = '<span>❌</span> Error'; setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
            }
        });

        uiContainer.querySelector('#btn-force-submit').addEventListener('click', () => {
            if (confirm("⚠ Are you sure?")) forceFinish();
        });

        uiContainer.querySelector('#search-input').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allQuestions.filter(q => q.title.toLowerCase().includes(term) || q.questionText.toLowerCase().includes(term));
            renderAnswers(filtered);
        });
    }

    function setupMutationObserver() {
        const startObserver = () => {
            const examBoard = document.getElementById('examboard');
            if (examBoard) {
                if (mutationObserver) mutationObserver.disconnect();
                mutationObserver = new MutationObserver(() => {
                    if (isAutoSolve) setTimeout(solveCurrentQuestion, 100);
                });
                mutationObserver.observe(examBoard, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
            } else { setTimeout(startObserver, 1000); }
        };
        startObserver();
    }

    function renderAnswers(questions) {
        const container = uiContainer ? uiContainer.querySelector('#answers-list') : null;
        if (!container) return;
        if (!questions || questions.length === 0) { container.innerHTML = '<div class="empty-state">No questions found.</div>'; return; }
        container.innerHTML = questions.map(q => {
            const optionsHtml = q.options.map(opt =>
                `<li class="ans-opt ${opt.isCorrect ? 'correct' : ''}">${opt.isCorrect ? '✅ ' : ''} ${escapeHtml(opt.text)}</li>`
            ).join('');
            return `
                <div class="ans-card">
                    <div class="ans-q-title">${escapeHtml(q.title)} <span style="font-size:10px;opacity:0.6">(${escapeHtml(q.level)})</span></div>
                    <div class="ans-q-text">${escapeHtml(q.questionText)}</div>
                    <ul class="ans-options">${optionsHtml}</ul>
                </div>`;
        }).join('');
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // ==========================================
    // 6. DRAG LOGIC
    // ==========================================
    function setupDrag(element, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            isDragging = true;

            startX = e.clientX;
            startY = e.clientY;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            element.style.transition = 'none';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.left = initialLeft + 'px';
            element.style.top = initialTop + 'px';
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            e.preventDefault();

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            element.style.left = (initialLeft + dx) + 'px';
            element.style.top = (initialTop + dy) + 'px';
        });

        document.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false;
                element.style.transition = '';
            }
        });
    }

    // ==========================================
    // 7. HELPER: EXTRACT FULL EXPLANATION TEXT
    // ==========================================
    function getExplanationText(root) {
        if (!root || !root.children) return "";
        const expNode = root.children.find(c =>
            c.type === 'olm-special-parent' && c.name === 'exp'
        );
        if (!expNode || !expNode.children) return "";
        let fullText = "";
        expNode.children.forEach(child => {
            fullText += extractTextWithMath(child) + "\n";
        });
        return fullText.trim();
    }

    function init() {
        if (document.body) {
            createUI();
            console.log("%c[OLM Ultimate Suite v5.14] ✅ Ready!", "background: #667eea; color: white; padding: 8px 12px; border-radius: 5px; font-weight: bold;");
        } else { setTimeout(init, 100); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
