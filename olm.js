// ==UserScript==
// @name         OLM Suite
// @namespace    http://tampermonkey.net/
// @version      1.5
// @updateURL    https://your-repo/olm-suite.meta.js
// @downloadURL  https://your-repo/olm-suite.user.js
// @description  Added Settings Tab, Custom Font/Color, New Minimize Design, Risk Patch v3.0 with Auto-Submit
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
    let uiContainer = null;

    // --- SETTINGS STATE ---
    const DEFAULT_SETTINGS = {
        fontSize: 13,
        primaryColor: '#667eea'
    };

    // ==========================================
    // MATH RENDERING HELPERS
    // ==========================================

    // Fallback: Convert LaTeX to plain text (Used for Search & Fallback display)
    function renderLatexToText(latex) {
        if (!latex) return "";
        return latex
            .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
            .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
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

    // New: Render LaTeX to HTML using KaTeX (Real Math Symbols) + Fix Line Breaks
    function extractRenderableHTML(node) {
        if (!node) return "";

        // Handle direct text nodes: convert newlines to <br> to preserve source formatting
        if (node.text && typeof node.text === 'string') {
            return escapeHtml(node.text).replace(/\n/g, '<br>');
        }

        if (!node.children || !Array.isArray(node.children)) return "";

        return node.children.map(child => {
            if (child.type === 'text' || child.type === 'extended-text') {
                return escapeHtml(child.text || "").replace(/\n/g, '<br>');
            }

            if (child.type === 'equation') {
                const latex = child.equation || child.latex_mathtype || "";
                // Check if site has loaded KaTeX (it usually does)
                if (window.katex && typeof window.katex.renderToString === 'function') {
                    try {
                        return window.katex.renderToString(latex, {
                            throwOnError: false,
                            displayMode: false,
                            output: 'html'
                        });
                    } catch (e) {
                        console.warn("KaTeX render error:", e);
                        return escapeHtml(renderLatexToText(latex));
                    }
                }
                // Fallback to text representation if KaTeX missing
                return escapeHtml(renderLatexToText(latex));
            }

            if (child.children) {
                const content = extractRenderableHTML(child);
                // If the child is a paragraph, append a line break to separate it from siblings
                // This fixes the "wall of text" issue when explanations are composed of multiple paragraphs
                if (child.type === 'paragraph' && content) {
                    return content + '<br>';
                }
                return content;
            }
            return "";
        }).join("");
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

            // Plain text version for searching/comparison
            let questionText = "";
            // HTML version for UI display (with real math)
            let questionHtml = "";

            let options = [];

            try {
                const contentStruct = JSON.parse(q.json_content);
                const root = contentStruct.root;

                if (root && root.children) {
                    const qNode = root.children.find(c => c.type === 'paragraph');
                    if (qNode) {
                        questionText = extractTextWithMath(qNode);
                        questionHtml = extractRenderableHTML(qNode);
                    }

                    const listNode = root.children.find(c =>
                        c.type === 'olm-list' || c.name === 'quiz-list'
                    );

                    if (listNode && listNode.children) {
                        listNode.children.forEach(opt => {
                            if (opt.type === 'olm-list-item' || opt.type === 'quiz-item') {
                                const text = extractTextWithMath(opt);
                                const textHtml = extractRenderableHTML(opt);
                                const latex = extractLatex(opt);
                                let isCorrect = opt.correct === true;
                                options.push({ text, textHtml, latex, isCorrect });
                            }
                        });
                    }

                    const qType = parseInt(q.q_type);
                    const isNonMultiChoice = [12, 13].includes(qType);

                    if (isNonMultiChoice || options.length === 0) {
                        const expNode = root.children.find(c => c.type === 'olm-special-parent' && c.name === 'exp');

                        if (expNode && expNode.children) {
                            // Extract full explanation as HTML
                            let fullExpHtml = "";
                            expNode.children.forEach(child => {
                                fullExpHtml += extractRenderableHTML(child);
                            });

                            // Extract plain text for search fallback
                            let fullExpText = "";
                            expNode.children.forEach(child => {
                                fullExpText += extractTextWithMath(child) + "\n";
                            });

                            options = [{
                                text: "📝 Solution/Explanation:\n" + fullExpText.trim(),
                                // We rely on extractRenderableHTML to handle the <br> insertion
                                // We just trim excessive trailing whitespace here
                                textHtml: "📝 Solution/Explanation:<br>" + fullExpHtml.replace(/(<br>\s*)+$/, ''),
                                latex: "",
                                isCorrect: true
                            }];
                        } else {
                            const fallbackAnswer = findAnswerInParagraphs(root);
                            if (fallbackAnswer) {
                                options.push({
                                    text: fallbackAnswer,
                                    textHtml: fallbackAnswer,
                                    latex: "",
                                    isCorrect: true
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("[OLM] Parse error:", title, e);
            }

            return { id, title, level, questionText, questionHtml, options };
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

        let styleTag = document.getElementById('olm-copy-bypass-css');
        if (enable) {
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

            window._olmBypassKeyHandler = (e) => {
                const k = e.key.toLowerCase();
                const isCtrl = e.ctrlKey || e.metaKey;

                if (isCtrl && k === 'c') {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    e.preventDefault();

                    const activeEl = document.activeElement;
                    let textToCopy = "";

                    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                        const s = activeEl.selectionStart;
                        const en = activeEl.selectionEnd;
                        textToCopy = activeEl.value.substring(s, en);
                    } else {
                        const selection = window.getSelection();
                        textToCopy = selection.toString();
                    }

                    if (textToCopy && textToCopy.length > 0) {
                        const doCopy = async (text) => {
                            try {
                                await navigator.clipboard.writeText(text);
                                console.log("[OLM] Manual Copy Success:", text.substring(0, 20) + "...");
                                if (window._toastbox) window._toastbox("Copied!");
                            } catch (err) {
                                console.error("[OLM] Manual Copy Failed", err);
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

                if (isCtrl && k === 'v') {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    return;
                }

                if (isCtrl && k === 'a') {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    return;
                }

                if (e.key === 'F12' || (isCtrl && ['f', 'u'].includes(k))) {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                    return;
                }
            };

            window.addEventListener('keydown', window._olmBypassKeyHandler, true);

            window._olmBypassCtxHandler = (e) => {
                e.stopImmediatePropagation();
                e.stopPropagation();
            };
            window.addEventListener('contextmenu', window._olmBypassCtxHandler, true);

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
        if (!enable) {
            showRefreshButton();
        } else {
            hideRefreshButton();
        }
    }

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
    // 4. SCORE PATCH LOGIC (RISK FEATURE v3.1)
    // ==========================================
    function injectScorePatch(fakeDuration, correctQuestionsCount) {
        if (typeof CATE_UI === 'undefined' || typeof CATE_UI.saveResult !== 'function') {
            alert("Error: CATE_UI not found. Make sure you are on the exam page.");
            return false;
        }

        if (!CATE_UI._olmOriginalSave) {
            CATE_UI._olmOriginalSave = CATE_UI.saveResult;
        }

        CATE_UI.saveResult = function(examData, callback) {
            if (examData) {
                console.log("%c[Exploit] OLM Universal Fix v3.1 Loading...", "color: cyan; font-size: 16px;");
                console.log("%c[Exploit] Intercepting saveResult...", "color: orange;");

                try {
                    // --- 1. TIME MANIPULATION (Merged from Old Code) ---
                    console.log(`%c[Exploit] Applying Time Patch: ${fakeDuration}s`, "color: yellow;");
                    examData.time_spent = fakeDuration;
                    examData.times = fakeDuration;

                    if (examData.time_stored) {
                        examData.date_end = parseInt(examData.time_stored) + fakeDuration;
                        console.log(`[Exploit] Updated date_end to: ${new Date(parseInt(examData.date_end) * 1000)}`);
                    } else {
                        examData.date_end = Math.floor(Date.now() / 1000) + fakeDuration;
                    }

                    // --- 2. PARSE DATA_LOG (From New Code) ---
                    var questions = [];
                    if (examData.data_log) {
                        try {
                            // Handle potential double-stringification
                            questions = JSON.parse(examData.data_log);
                        } catch (e) {
                            if (typeof examData.data_log === 'object') {
                                questions = examData.data_log;
                            }
                        }
                    }

                    // Calculate total questions dynamically based on the log length
                    var totalQuestions = (Array.isArray(questions)) ? questions.length : (examData.count_problems || (examData.correct + examData.wrong + examData.missed) || 1);
                    console.log(`[Exploit] Total Questions Detected: ${totalQuestions}`);

                    // --- 3. FIX DATA_LOG (The Detailed View Fix) ---
                    // This loop ensures the "Questions & Answer" view shows everything Correct
                    if (Array.isArray(questions)) {
                        for (var i = 0; i < questions.length; i++) {
                            var q = questions[i];

                            // KEY FIX: Set 'chk' to 1 (Visual Green Check)
                            q.chk = 1;
                            q.correct = 1;
                            q.wrong = 0;

                            // Fix 'result' array
                            if (Array.isArray(q.result)) {
                                for (var j = 0; j < q.result.length; j++) {
                                    q.result[j] = 1;
                                }
                            } else {
                                q.result = [1];
                            }

                            // Randomize time spent per question for realism (from Old Code)
                            q.time_spent = Math.floor(Math.random() * 15) + 10;

                            // Clean up skills
                            if (q.wrong_skill) q.wrong_skill = [];
                        }
                        examData.data_log = JSON.stringify(questions);
                        console.log("%c[Exploit] Detailed View Patched (All Green).", "color: lightgreen;");
                    }

                    // --- 4. CALCULATE SCORE BASED ON USER INPUT ---
                    // Ensure correctCount doesn't exceed total
                    var finalCorrect = parseInt(correctQuestionsCount);
                    if (isNaN(finalCorrect) || finalCorrect > totalQuestions) finalCorrect = totalQuestions;
                    if (finalCorrect < 0) finalCorrect = 0;

                    var finalWrong = totalQuestions - finalCorrect;
                    var finalMissed = 0;

                    console.log(`%c[Exploit] Score Config: ${finalCorrect} Correct / ${finalWrong} Wrong`, "color: #f0f;");

                    // Fix TOP-LEVEL SCORES (The Summary Table Fix)
                    examData.correct = finalCorrect;
                    examData.wrong = finalWrong;
                    examData.missed = finalMissed;

                    // Calculate Score
                    var maxScore = examData.max_score || 10;
                    var calculatedScore = (finalCorrect / totalQuestions) * maxScore;

                    examData.score = parseFloat(calculatedScore.toFixed(2));
                    examData.tn_score = parseFloat(calculatedScore.toFixed(2)); // Multiple Choice Score
                    examData.tl_score = 0; // Essay Score

                    examData.correct_skill = [];
                    examData.wrong_skill = [];

                    console.log(`%c[Exploit] Final Score Applied: ${examData.score}/${maxScore}`, "color: green; font-weight: bold; font-size: 14px;");
                    console.log("%c[Exploit] Data patched. Sending to server...", "color: green;");

                } catch (err) {
                    console.error("%c[Exploit] Error during patching:", "color: red;", err);
                }
            }

            // Execute the original save function with our modified data
            return CATE_UI._olmOriginalSave.call(this, examData, callback);
        };

        console.log("%c[Exploit] Hooked Successfully. Ready for auto-submit.", "color: lime; background: #222; padding: 5px;");
        return true;
    }

    // ==========================================
    // 5. SETTINGS LOGIC
    // ==========================================
    function saveSettings() {
        const fontSize = document.getElementById('setting-font-size').value;
        const color = document.getElementById('setting-color').value;

        const settings = {
            fontSize: fontSize,
            primaryColor: color
        };

        localStorage.setItem('olm_suite_settings', JSON.stringify(settings));
        applySettings(settings);
        alert("Settings Saved!");
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem('olm_suite_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                applySettings(settings);

                // Update inputs if they exist
                setTimeout(() => {
                    const fontInput = document.getElementById('setting-font-size');
                    const colorInput = document.getElementById('setting-color');
                    if (fontInput) fontInput.value = settings.fontSize;
                    if (colorInput) colorInput.value = settings.primaryColor;
                }, 100);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    function applySettings(settings) {
        if (!uiContainer) return;

        // Apply Font Size
        uiContainer.style.setProperty('--olm-font-size', settings.fontSize + 'px');

        // Apply Color
        uiContainer.style.setProperty('--olm-primary-color', settings.primaryColor);
    }

    // ==========================================
    // 6. UI GENERATION & PERSISTENCE
    // ==========================================
    function createUI() {
        uiContainer = document.createElement('div');
        uiContainer.id = 'olm-v3-container';
        // Add minimized class immediately for default state
        uiContainer.classList.add('minimized');

        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

            #olm-v3-container {
                --olm-font-size: 13px;
                --olm-primary-color: #667eea;

                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 380px;
                height: auto;
                min-width: 300px;
                min-height: 100px;
                max-height: 90vh;
                background: rgba(20, 20, 25, 0.98);
                border: 1px solid rgba(255,255,255,0.2); border-radius: 12px;
                box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8); color: #fff;
                font-family: 'Inter', sans-serif; z-index: 2147483647; display: flex; flex-direction: column;
                transition: opacity 0.2s;
                resize: none;

                font-size: var(--olm-font-size);
            }

            /* --- MINIMIZED STATE (PILL SHAPE) --- */
            #olm-v3-container.minimized {
                width: auto !important;
                height: 40px !important;
                min-height: 40px !important;
                padding: 0;
                border-radius: 20px;
                overflow: hidden;
                flex-shrink: 0;
            }
            #olm-v3-container.minimized #olm-header {
                padding: 0 15px;
                height: 100%;
                border-radius: 20px;
                background: var(--olm-primary-color);
            }
            #olm-v3-container.minimized .olm-tabs,
            #olm-v3-container.minimized #olm-body,
            #olm-v3-container.minimized .resize-handle {
                display: none !important;
            }
            #olm-v3-container.minimized #olm-title { font-size: 12px; font-weight: 600; margin: 0; }
            #olm-v3-container.minimized .btn-minimize { display: flex; width: 24px; height: 24px; font-size: 14px; }

            /* --- HEADER --- */
            #olm-header { background: linear-gradient(135deg, var(--olm-primary-color), #764ba2); padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; border-radius: 12px 12px 0 0; flex-shrink: 0; }
            #olm-title { font-weight: 700; font-size: 1.1em; display: flex; align-items: center; gap: 8px; pointer-events: none; }
            .btn-minimize { background: rgba(255,255,255,0.2); border: none; color: white; font-size: 18px; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
            .btn-minimize:hover { background: rgba(255,255,255,0.3); }

            /* --- TABS --- */
            .olm-tabs { display: flex; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
            .olm-tab-btn { flex: 1; background: transparent; border: none; color: #8b9bb4; padding: 12px; cursor: pointer; font-weight: 600; font-size: 0.9em; transition: all 0.2s; }
            .olm-tab-btn.active { color: #fff; background: rgba(255,255,255,0.1); border-bottom: 2px solid var(--olm-primary-color); }

            /* --- BODY --- */
            #olm-body { padding: 15px; overflow-y: auto; flex-grow: 1; position: relative; }
            .tab-content { display: none; } .tab-content.active { display: block; animation: fadeIn 0.3s; }
            .olm-row { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; margin-bottom: 8px; }
            .olm-label { font-size: 0.95em; font-weight: 500; display: flex; align-items: center; gap: 8px; pointer-events: auto; }
            .switch { position: relative; width: 40px; height: 22px; flex-shrink: 0; } .switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 34px; pointer-events: auto; }
            .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .slider { background: var(--olm-primary-color); } input:checked + .slider:before { transform: translateX(18px); }

            /* --- BUTTONS --- */
            .olm-btn { width: 100%; padding: 10px; border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.1s; font-size: 0.9em; }
            .olm-btn:active { transform: scale(0.98); } .btn-get { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
            .btn-force { background: linear-gradient(135deg, #cb2d3e 0%, #ef473a 100%); }

            /* --- INPUTS --- */
            #search-input { width: 100%; padding: 10px; margin-bottom: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; font-family: inherit; box-sizing: border-box; }
            #search-input:focus { outline: none; border-color: var(--olm-primary-color); }

            /* --- ANSWERS --- */
            #answers-list { display: flex; flex-direction: column; gap: 12px; }
            .ans-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; font-size: 1em; }
            .ans-q-title { color: var(--olm-primary-color); font-weight: 700; margin-bottom: 4px; }
            .ans-q-text { margin-bottom: 8px; line-height: 1.4; color: #ddd; }
            .ans-options { list-style: none; padding: 0; margin: 0; }
            .ans-opt { padding: 8px; margin-bottom: 2px; border-radius: 4px; font-size: 1em; white-space: pre-wrap; line-height: 1.6; word-wrap: break-word; }
            .ans-opt.correct { background: rgba(56, 239, 125, 0.1); color: #38ef7d; font-weight: 600; border: 1px solid rgba(56, 239, 125, 0.3); }

            /* --- RISK & SETTINGS --- */
            .risk-group, .settings-group { margin-top: 10px; padding: 10px; border: 1px solid rgba(255, 50, 50, 0.4); background: rgba(60, 0, 0, 0.2); border-radius: 8px; display: none; }
            .risk-group.visible, .settings-group.visible { display: block; animation: fadeIn 0.3s; }
            .time-input-row, .setting-row { display: flex; gap: 5px; margin-bottom: 8px; align-items: center; }
            .time-label, .setting-label { font-size: 0.9em; color: #aaa; white-space: nowrap; }
            .time-input, .setting-input { flex: 1; padding: 8px; border: 1px solid #555; background: #111; color: white; border-radius: 4px; font-family: inherit; }
            .time-input:focus, .setting-input:focus { outline: none; border-color: #ff4b2b; }
            .btn-risk { background: linear-gradient(135deg, #ff416c, #ff4b2b); }

            /* --- KATEX FIX --- */
            /* Force KaTeX to follow container font size */
            .katex { font-size: 1em !important; }
            .katex-display { margin: 0.5em 0; overflow-x: auto; overflow-y: hidden; }

            /* --- UTILS --- */
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            #olm-refresh-btn {
                position: fixed; left: 30px; top: 100px;
                background: rgba(255, 193, 7, 0.95);
                color: #000; padding: 12px 20px; border-radius: 8px;
                cursor: pointer; z-index: 2147483646; display: none;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                font-weight: 600; font-family: 'Inter', sans-serif;
                align-items: center; gap: 8px; transition: transform 0.1s;
                border: 2px solid #fff;
            }
            #olm-refresh-btn:hover { transform: scale(1.05); background: rgba(255, 165, 0, 0.95); }

            .resize-handle {
                width: 20px; height: 20px; position: absolute; bottom: 0; right: 0;
                cursor: nwse-resize; z-index: 10;
                background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%);
                border-bottom-right-radius: 12px;
            }
            .resize-handle:hover { background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.6) 50%); }
        `;
        document.head.appendChild(style);

        uiContainer.innerHTML = `
            <div id="olm-header">
                <div id="olm-title"><span class="long-title">🔮 OLM v1.5</span><span class="short-title" style="display:none;">OLM</span></div>
                <button id="btn-minimize" class="btn-minimize">+</button>
            </div>
            <div class="olm-tabs">
                <button class="olm-tab-btn active" data-tab="tools">Tools</button>
                <button class="olm-tab-btn" data-tab="answers">Answers</button>
                <button class="olm-tab-btn" data-tab="settings">Settings</button>
            </div>
            <div id="olm-body">
                <div id="tab-tools" class="tab-content active">
                    <div class="olm-row"><div class="olm-label">🛡️ Anti-AC</div><label class="switch"><input type="checkbox" id="chk-anticheat"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">🚫 Block Submit</div><label class="switch"><input type="checkbox" id="chk-block"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">👁 Review Mode</div><label class="switch"><input type="checkbox" id="chk-review"><span class="slider"></span></label></div>
                    <div class="olm-row"><div class="olm-label">⏳ Freeze Time</div><label class="switch"><input type="checkbox" id="chk-freeze"><span class="slider"></span></label></div>

                    <div class="olm-row"><div class="olm-label">⚠ Risk Features</div><label class="switch"><input type="checkbox" id="chk-risk"><span class="slider"></span></label></div>

                    <div id="risk-container" class="risk-group">
                        <div class="time-input-row">
                            <span class="time-label">Correct (Q):</span>
                            <input type="number" id="input-correct-count" class="time-input" value="999" min="0" placeholder="Max">
                        </div>
                        <div class="time-input-row">
                            <span class="time-label">Fake Time (Sec):</span>
                            <input type="number" id="input-fake-time" class="time-input" value="60" min="0">
                        </div>
                        <button id="btn-full-score" class="olm-btn btn-risk"><span>🚀</span> Patch & Auto-Submit</button>
                    </div>

                    <button id="btn-get-file" class="olm-btn btn-get"><span>📄</span> Get File Link</button>
                    <button id="btn-force-submit" class="olm-btn btn-force"><span>⚠</span> Force Finish</button>
                </div>
                <div id="tab-answers" class="tab-content"><input type="text" id="search-input" placeholder="🔍 Search questions..."><div id="answers-list"><div class="empty-state">Waiting for sniffer...</div></div></div>
                <div id="tab-settings" class="tab-content">
                    <div class="settings-group visible">
                        <div class="setting-row">
                            <span class="setting-label">Font Size</span>
                            <input type="range" id="setting-font-size" class="setting-input" min="10" max="20" step="1" value="13">
                            <span id="font-size-val" style="width:30px; text-align:right; color:#fff;">13</span>
                        </div>
                        <div class="setting-row">
                            <span class="setting-label">Theme Color</span>
                            <input type="color" id="setting-color" class="setting-input" value="#667eea" style="padding:2px; height:30px;">
                        </div>
                        <button id="btn-save-settings" class="olm-btn btn-get"><span>💾</span> Save Settings</button>
                    </div>
                </div>
            </div>
            <div class="resize-handle"></div>
        `;

        document.body.appendChild(uiContainer);

        setupResize(uiContainer);
        setupDrag(uiContainer, document.getElementById('olm-header'));
        setupUIEvents();
        setupUIPersistence();
        loadSettings(); // Load saved settings

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

    function setupResize(element) {
        const handle = element.querySelector('.resize-handle');
        if (!handle) return;

        let startX, startY, startWidth, startHeight;

        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();

            startX = e.clientX;
            startY = e.clientY;

            const rect = element.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;

            element.style.transition = 'none';

            const doDrag = function(e) {
                element.style.width = (startWidth + e.clientX - startX) + 'px';
                element.style.height = (startHeight + e.clientY - startY) + 'px';
            };

            const stopDrag = function() {
                document.documentElement.removeEventListener('mousemove', doDrag, false);
                document.documentElement.removeEventListener('mouseup', stopDrag, false);
                element.style.transition = '';
            };

            document.documentElement.addEventListener('mousemove', doDrag, false);
            document.documentElement.addEventListener('mouseup', stopDrag, false);
        });
    }

    function setupUIPersistence() {
        const observer = new MutationObserver((mutations) => {
            if (uiContainer && document.body && !document.body.contains(uiContainer)) {
                console.log("%c[OLM] UI was removed, restoring...", "color: #f0f; font-weight: bold;");
                document.body.appendChild(uiContainer);
            }
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

        // Risk Feature Toggle
        uiContainer.querySelector('#chk-risk').addEventListener('change', (e) => {
            const container = uiContainer.querySelector('#risk-container');
            if (e.target.checked) {
                container.classList.add('visible');
            } else {
                container.classList.remove('visible');
            }
        });

        // Patch & Auto-Submit Button
        uiContainer.querySelector('#btn-full-score').addEventListener('click', () => {
            const timeInput = uiContainer.querySelector('#input-fake-time');
            const correctInput = uiContainer.querySelector('#input-correct-count');

            let seconds = parseInt(timeInput.value);
            if (isNaN(seconds) || seconds < 0) seconds = 60;

            let correctCount = parseInt(correctInput.value);
            if (isNaN(correctCount) || correctCount < 0) correctCount = 999; // Default to max if invalid

            if (confirm(`This will Patch the data AND automatically Submit the exam.\n\nTime: ${seconds}s\nCorrect Count: ${correctCount}\n\nAre you sure?`)) {
                const success = injectScorePatch(seconds, correctCount);
                if (success) {
                    // Small delay to ensure the hook is properly set before triggering the event
                    setTimeout(() => {
                        console.log("%c[Exploit] Triggering Force Finish...", "color: red;");
                        forceFinish();
                    }, 500);
                }
            }
        });

        // Minimize Button
        uiContainer.querySelector('#btn-minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            uiContainer.classList.toggle('minimized');
            const isMinimized = uiContainer.classList.contains('minimized');

            // Toggle Titles
            uiContainer.querySelector('.long-title').style.display = isMinimized ? 'none' : 'inline';
            uiContainer.querySelector('.short-title').style.display = isMinimized ? 'inline' : 'none';

            // If opening, ensure tabs are reset to Tools
            if (!isMinimized) {
                switchTab('tools');
            }
        });

        // Settings Inputs
        const fontInput = uiContainer.querySelector('#setting-font-size');
        const colorInput = uiContainer.querySelector('#setting-color');

        // Live Font Preview
        fontInput.addEventListener('input', (e) => {
            document.getElementById('font-size-val').textContent = e.target.value;
            uiContainer.style.setProperty('--olm-font-size', e.target.value + 'px');
        });

        // Live Color Preview
        colorInput.addEventListener('input', (e) => {
            uiContainer.style.setProperty('--olm-primary-color', e.target.value);
        });

        // Save Button
        uiContainer.querySelector('#btn-save-settings').addEventListener('click', saveSettings);

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

    function renderAnswers(questions) {
        const container = uiContainer ? uiContainer.querySelector('#answers-list') : null;
        if (!container) return;
        if (!questions || questions.length === 0) { container.innerHTML = '<div class="empty-state">No questions found.</div>'; return; }
        container.innerHTML = questions.map(q => {
            const qHtml = q.questionHtml || escapeHtml(q.questionText);

            const optionsHtml = q.options.map(opt => {
                const optHtml = opt.textHtml || escapeHtml(opt.text);
                return `<li class="ans-opt ${opt.isCorrect ? 'correct' : ''}">${opt.isCorrect ? '✅ ' : ''} ${optHtml}</li>`;
            }).join('');

            return `
                <div class="ans-card">
                    <div class="ans-q-title">${escapeHtml(q.title)} <span style="font-size:0.8em;opacity:0.6">(${escapeHtml(q.level)})</span></div>
                    <div class="ans-q-text">${qHtml}</div>
                    <ul class="ans-options">${optionsHtml}</ul>
                </div>`;
        }).join('');
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function setupDrag(element, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target.closest('.btn-minimize')) return;

            isDragging = true;

            startX = e.clientX;
            startY = e.clientY;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            element.style.transition = 'none';
            element.style.bottom = 'auto';
            element.style.right = 'auto';
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

    function init() {
        if (document.body) {
            createUI();
            console.log("%c[OLM Ultimate Suite v1.5] ✅ Ready!", "background: #667eea; color: white; padding: 8px 12px; border-radius: 5px; font-weight: bold;");
        } else { setTimeout(init, 100); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
