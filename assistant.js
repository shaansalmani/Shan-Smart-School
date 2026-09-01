/**
 * Anime AI Assistant Core Controller
 * Handles Animation State Machine, Alpha Video Rendering, Drag-and-Drop,
 * Browser SpeechSynthesis Audio, Speech Recognition,
 * Natural Language Command Routing, and Smart School Device Bridge.
 */

class AnimeAssistant {
  constructor(config) {
    this.config = config || window.ASSISTANT_CONFIG || {};
    this.currentState = 'IDLE';
    this.aiIdentity = {
      name: this.config.assistantName || (this.config.aiIdentity && this.config.aiIdentity.name) || 'Aoi',
      role: 'Smart School AI Assistant',
      school: 'BAV INTER COLLEGE',
      creator: 'Shan'
    };
    window.aiIdentity = this.aiIdentity;
    this.loadAISettings();
    this.isDragging = false;
    this.isMuted = false;
    this.isListening = false;
    this.voiceEnabled = true;
    this.isMinimized = false;
    this.hasGreeted = false;
    this.greetingAudioPlayed = false;
    this.wakeWord = (this.config.wakeWord || this.aiIdentity.name || 'Aoi').toLowerCase();
    this.wakeArmed = false;
    this.wakeListeningTimer = null;
    this.currentAudio = null;
    this.speechRecognition = null;
    this.dragThreshold = 6;
    this.pointerStartPos = { x: 0, y: 0 };
    this.elementStartPos = { x: 0, y: 0 };
    this.dragVideoStarted = false;
    this.stateTimer = null;
    this.typingTimer = null;
    this.activeBackendAbortController = null;
    this.backendAvailable = false;


    // Phase 12: Single Authoritative Voice Manager & State Machine
    this.voiceManager = {
      state: 'IDLE', // IDLE, LISTEN, PROCESS, SPEAK, ERROR
      recognition: null,
      isListening: false,
      isSpeaking: false,
      wakeArmed: false,
      wakeTimer: null,
      contextActive: false,
      contextTimer: null,
      restartTimer: null,
      permissionState: 'prompt', // 'granted', 'prompt', 'denied'
      interrupted: false,
      lastTranscript: ''
    };


    this.initDOM();
    this.initVideoPlayer();
    this.initDragAndDrop();
    this.initVoiceManager();
    this.initEventListeners();
    this.startGreetingFlow();
  }

  // Safe Python Backend Chat Query with AbortController and timeout handling
  async queryBackendAI(message) {
    const baseUrl = this.config.apiBaseUrl || 'http://127.0.0.1:8000';
    const timeoutMs = this.config.backendTimeout || 10000;

    // Abort any preceding in-flight request to prevent race conditions
    if (this.activeBackendAbortController) {
      try { this.activeBackendAbortController.abort(); } catch (_) {}
    }
    this.activeBackendAbortController = new AbortController();
    const signal = this.activeBackendAbortController.signal;

    const timeoutId = setTimeout(() => {
      if (this.activeBackendAbortController) {
        this.activeBackendAbortController.abort();
      }
    }, timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message }),
        signal: signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      this.backendAvailable = true;
      return {
        success: data.success !== false,
        message: data.message || message,
        response: data.response || "I received your message.",
        intent: data.intent || null,
        tool_used: data.tool_used || null,
        used_web_search: false,
        sources: data.sources || [],
        is_arduino_command: !!data.is_arduino_command,
        arduino_device: data.arduino_device || null,
        arduino_action: data.arduino_action || null,
        serial_command: data.serial_command || null,
        is_pc_command: !!data.is_pc_command,
        pc_action: data.pc_action || null,
        pc_target: data.pc_target || null,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.warn('[Assistant] Backend request timed out or was aborted.');
        return {
          success: false,
          response: "AI is taking too long to respond. Please try again.",
          isTimeout: true,
        };
      }
      console.warn('[Assistant] Backend request failed:', err.message);
      const userMessage = (err.message && err.message !== 'Failed to fetch')
        ? err.message
        : "Mujhe abhi ye command samajh nahi aayi. Please command ko thoda aur clearly bolo.";
      return {
        success: false,
        response: userMessage,
        isOffline: true,
      };
    } finally {
      this.activeBackendAbortController = null;
    }
  }

  // Build Floating UI Overlay
  initDOM() {
    let root = document.getElementById('anime-assistant-root');
    if (root) root.remove();

    root = document.createElement('div');
    root.id = 'anime-assistant-root';
    root.className = 'anime-assistant-container';
    root.setAttribute('aria-label', 'Anime AI Assistant');
    root.setAttribute('role', 'region');

    const currentName = this.aiIdentity?.name || this.config.assistantName || 'Aoi';
    const greetingText = `Hi! I am ${currentName}. How can I help you?`;

    root.innerHTML = `
      <div class="assistant-speech-bubble" id="assistantSpeechBubble">
        <div class="bubble-header">
          <div class="bubble-controls">
            <button type="button" class="bubble-btn" id="assistantMuteBtn" title="Toggle Sound">🔊</button>
            <button type="button" class="bubble-btn" id="assistantMinBtn" title="Minimize / Maximize">−</button>
          </div>
          <span class="assistant-name" id="assistantHeaderName">✨ ${this.escapeHTML(currentName)} • AI Assistant</span>
        </div>
        <div class="bubble-content" id="assistantBubbleText">Hi! I am ${this.escapeHTML(currentName)}. How can I help you?</div>
        <div class="assistant-quick-chips" id="assistantQuickChips">
          <button type="button" class="chip-btn" data-cmd="light on">💡 Light ON</button>
          <button type="button" class="chip-btn" data-cmd="light off">💡 Light OFF</button>
          <button type="button" class="chip-btn" data-cmd="buzzer on">🔔 Buzzer ON</button>
          <button type="button" class="chip-btn" data-cmd="buzzer off">🔔 Buzzer OFF</button>
          <button type="button" class="chip-btn" data-cmd="gate open">🚪 Gate OPEN</button>
          <button type="button" class="chip-btn" data-cmd="gate close">🚪 Gate CLOSE</button>
          <button type="button" class="chip-btn" data-cmd="pump on">🚰 Pump ON</button>
          <button type="button" class="chip-btn" data-cmd="pump off">🚰 Pump OFF</button>
          <button type="button" class="chip-btn" data-cmd="fans on">🌀 Fans ON</button>
          <button type="button" class="chip-btn" data-cmd="fans off">🌀 Fans OFF</button>
          <button type="button" class="chip-btn" data-cmd="what time is it">⏰ Live Time</button>
          <button type="button" class="chip-btn" data-cmd="status">📊 School Status</button>
          <button type="button" class="chip-btn" id="assistantAICustomizeBtn">⚙ AI CUSTOMIZE</button>
        </div>
        <form class="assistant-input-form" id="assistantInputForm">
          <input type="text" id="assistantTextInput" class="assistant-text-input" placeholder="Type a command or question..." autocomplete="off" />
          <button type="button" class="assistant-mic-btn voice-toggle-on" id="assistantMicBtn" title="Voice listening ON">
            <span class="material-icons-outlined" id="assistantMicIcon">mic</span>
            <span id="assistantMicLabel" aria-hidden="true"></span>
          </button>
          <button type="submit" class="assistant-send-btn" title="Send Command">
            <span class="material-icons-outlined">send</span>
          </button>
        </form>
      </div>

      <div class="assistant-avatar-wrapper" id="assistantAvatarWrapper" title="Click to open/close chat • Drag to move">
        <div class="assistant-drag-handle" title="Drag to move assistant"><span class="drag-indicator">⋮⋮</span></div>
        <div class="assistant-video-stage" id="assistantVideoStage">
          <video id="assistantVideoPrimary" class="assistant-video active" preload="auto" muted playsinline></video>
          <video id="assistantVideoSecondary" class="assistant-video" preload="auto" muted playsinline></video>
        </div>
        <div class="assistant-state-badge" id="assistantStateBadge">HELLO</div>
      </div>
    `;

    document.body.appendChild(root);

    this.dom = {
      root,
      speechBubble: document.getElementById('assistantSpeechBubble'),
      bubbleText: document.getElementById('assistantBubbleText'),
      avatarWrapper: document.getElementById('assistantAvatarWrapper'),
      videoStage: document.getElementById('assistantVideoStage'),
      videoPrimary: document.getElementById('assistantVideoPrimary'),
      videoSecondary: document.getElementById('assistantVideoSecondary'),
      stateBadge: document.getElementById('assistantStateBadge'),
      micBtn: document.getElementById('assistantMicBtn'),
      micIcon: document.getElementById('assistantMicIcon'),
      micLabel: document.getElementById('assistantMicLabel'),
      muteBtn: document.getElementById('assistantMuteBtn'),
      minBtn: document.getElementById('assistantMinBtn'),
      inputForm: document.getElementById('assistantInputForm'),
      textInput: document.getElementById('assistantTextInput'),
      quickChips: document.getElementById('assistantQuickChips'),
      teachBtn: document.getElementById('assistantTeachBtn'),
    };

    this.setDefaultPosition();
  }

  normalizeQuestion(text) {
    return String(text || '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
  }

  escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  toggleChatBox() {
    this.isMinimized=!this.isMinimized;
    if(this.dom?.speechBubble) this.dom.speechBubble.classList.toggle('minimized',this.isMinimized);
    if(this.dom?.minBtn){ this.dom.minBtn.textContent=this.isMinimized?'□':'−'; this.dom.minBtn.title=this.isMinimized?'Maximize':'Minimize'; }
  }

  setDefaultPosition() {
    const isMobile = window.innerWidth <= 768;
    const initialBottom = isMobile ? 80 : 30;
    const initialRight = isMobile ? 15 : 30;

    this.dom.root.style.bottom = `${initialBottom}px`;
    this.dom.root.style.right = `${initialRight}px`;
    this.dom.root.style.left = 'auto';
    this.dom.root.style.top = 'auto';
  }

  // Helper to determine active AI state to return to after DROP or transient states
  getActiveAIState() {
    if (this.voiceManager && this.voiceManager.isSpeaking) return 'SPEAK';
    if (this.voiceManager && (this.voiceManager.wakeArmed || this.voiceManager.isListening)) return 'LISTEN';
    return 'IDLE';
  }

  // Preload and manage HTML5 video playback with lazy loading, memory caching and MP4 fallback
  initVideoPlayer() {
    this.activeVideoEl = this.dom.videoPrimary;
    this.inactiveVideoEl = this.dom.videoSecondary;
    this.loadedVideoCache = new Set();

    [this.dom.videoPrimary, this.dom.videoSecondary].forEach(video => {
      video.muted = true;
      video.playsInline = true;

      video.addEventListener('loadeddata', () => {
        const src = video.dataset.src || video.src || video.currentSrc || '';
        console.log(`[Assistant Video] loadeddata for: ${src}`);
      });

      video.addEventListener('canplay', () => {
        const src = video.dataset.src || video.src || video.currentSrc || '';
        console.log(`[Assistant Video] canplay for: ${src}`);
      });

      video.addEventListener('ended', () => {
        if (this.currentState === 'HELLO') {
          console.log('[Assistant] HELLO animation ended -> Transitioning to IDLE');
          this.setState('IDLE');
        } else if (this.currentState === 'DONE') {
          console.log('[Assistant] DONE animation ended -> Transitioning to IDLE');
          this.setState('IDLE');
        } else if (this.currentState === 'DROP') {
          console.log('[Assistant Drag] drop animation ended');
          const returnState = this.getActiveAIState();
          console.log(`[Assistant Drag] Returning to ${returnState}`);
          this.setState(returnState);
        }
      });

      video.addEventListener('error', (e) => {
        const failedSrc = video.dataset.src || video.src || video.currentSrc || '';
        const errCode = video.error ? video.error.code : 'UNKNOWN';
        const errMsg = video.error ? video.error.message : 'No error message available';
        console.warn(`[Assistant Video Error] failedSrc='${failedSrc}', currentSrc='${video.currentSrc}', code=${errCode}, message='${errMsg}'`, e);
        if (this.currentState === 'DRAG' || this.currentState === 'DROP') {
          console.log(`[Assistant Drag] Drag/Drop video fallback to idle/breathing`);
          const returnState = this.getActiveAIState();
          this.setState(returnState);
        } else if (failedSrc.endsWith('.webm')) {
          const fallbackSrc = failedSrc.replace('assets/videos/optimized/', 'ai anime girl/').replace('.webm', '.mp4');
          console.log(`[Assistant] Trying MP4 fallback: ${fallbackSrc}`);
          this.loadAnimationVideo(video, fallbackSrc, true);
          video.play().catch((err) => console.warn('[Assistant] MP4 fallback play failed:', err));
        }
      });
    });

    // Proactively preload DRAG and DROP videos in background so dragging starts instantaneously
    const animMap = this.config.animations || {};
    const dragSrc = this.config.dragAnimationVideo || animMap.drag || "assets/videos/optimized/WhatsApp Video 2026-08-29 at 8.28.46 PM.mp4";
    const dropSrc = this.config.dropAnimationVideo || animMap.drop || "assets/videos/optimized/Shan.mp4";
    
    [dragSrc, dropSrc].forEach(src => {
      if (src) {
        const preloadLink = document.createElement('link');
        preloadLink.rel = 'preload';
        preloadLink.as = 'video';
        preloadLink.href = src;
        document.head.appendChild(preloadLink);
      }
    });
  }

  // Safe video loader that handles lazy loading, caching and preventing duplicate loads
  loadAnimationVideo(video, src, force = false) {
    if (!video || !src) return;
    video.dataset.src = src;
    const isAlreadyLoaded = !force && (video.src.includes(encodeURI(src)) || video.currentSrc.includes(src) || (video.src && video.src.endsWith(src)));
    if (!isAlreadyLoaded) {
      video.src = src;
      try {
        video.load();
      } catch (err) {
        console.warn(`[Assistant] AI animation failed to load: ${src}`, err);
      }
      this.loadedVideoCache.add(src);
    }
  }

  // Animation State Transition
  setState(newState) {
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }

    const prevState = this.currentState;
    this.currentState = newState;
    console.log(`[Assistant] State transition: ${prevState} -> ${newState}`);

    if (this.dom.stateBadge) {
      this.dom.stateBadge.textContent = newState;
      this.dom.stateBadge.className = `assistant-state-badge state-${newState.toLowerCase()}`;
    }

    const animMap = this.config.animations || {};
    let targetSrc = null;
    let shouldLoop = true;
    let targetRate = 1.0;

    switch (newState) {
      case 'HELLO':
        targetSrc = animMap.hello;
        shouldLoop = false;
        break;
      case 'IDLE':
        targetSrc = animMap.idle;
        shouldLoop = true;
        break;
      case 'LISTEN':
        targetSrc = animMap.listen;
        shouldLoop = true;
        break;
      case 'PROCESS':
        targetSrc = animMap.process;
        shouldLoop = true;
        break;
      case 'SPEAK':
        targetSrc = animMap.speak;
        shouldLoop = true;
        break;
      case 'DONE':
        targetSrc = animMap.done;
        shouldLoop = false;
        break;
      case 'DRAG':
        targetSrc = this.config.dragAnimationVideo || animMap.drag || "assets/videos/optimized/WhatsApp Video 2026-08-29 at 8.28.46 PM.mp4";
        shouldLoop = true;
        targetRate = this.config.dragPlaybackRate || 1.10;
        break;
      case 'DROP':
        targetSrc = this.config.dropAnimationVideo || animMap.drop || "assets/videos/optimized/Shan.mp4";
        shouldLoop = false;
        targetRate = this.config.dropPlaybackRate || 1.10;
        break;
      default:
        targetSrc = animMap.idle;
        shouldLoop = true;
    }

    if (!targetSrc) {
      console.warn(`[Assistant] MISSING ASSET: ${newState} animation is not mapped, falling back to IDLE.`);
      if (newState !== 'IDLE') {
        this.setState('IDLE');
      }
      return;
    }

    this.playVideoSource(targetSrc, shouldLoop, newState, targetRate);

    if (newState === 'DONE') {
      const fallbackMs = (this.config.states && this.config.states.DONE && this.config.states.DONE.durationMs) || 2600;
      this.stateTimer = setTimeout(() => {
        if (this.currentState === 'DONE') {
          this.setState('IDLE');
        }
      }, fallbackMs);
    } else if (newState === 'DROP') {
      // DROP uses the complete Shan.mp4 animation. Return only after the video naturally ends.
      // No fixed timeout: long animations are allowed to finish completely.
    }
  }

  async playVideoSource(src, loop, stateName, playbackRate = 1.0) {
    const nextVideo = this.inactiveVideoEl;
    const currentVideo = this.activeVideoEl;
    if (!nextVideo || !currentVideo || !src) return;

    const playReady = async (video) => {
      video.muted = true;
      video.playsInline = true;
      video.loop = loop;
      try { video.playbackRate = playbackRate; } catch (_) {}
      try { video.currentTime = 0; } catch (_) {}

      // Do not call play() before the newly assigned MP4 is ready. Chrome can
      // reject that promise with NotSupportedError/AbortError on a cold load.
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('canplay', finish);
            video.removeEventListener('loadeddata', finish);
            video.removeEventListener('error', fail);
            resolve();
          };
          const fail = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('canplay', finish);
            video.removeEventListener('loadeddata', finish);
            video.removeEventListener('error', fail);
            reject(video.error || new Error(`Unable to load ${src}`));
          };
          video.addEventListener('canplay', finish, { once: true });
          video.addEventListener('loadeddata', finish, { once: true });
          video.addEventListener('error', fail, { once: true });
          try { video.load(); } catch (e) { fail(); }
        });
      }

      const promise = video.play();
      if (promise) await promise;
      try { video.playbackRate = playbackRate; } catch (_) {}
    };

    const isCurrentMatch = currentVideo.dataset.src === src ||
      currentVideo.src.includes(encodeURI(src)) || currentVideo.currentSrc.includes(src);

    try {
      if (isCurrentMatch) {
        await playReady(currentVideo);
        if (stateName === 'DRAG') console.log('[Assistant Drag] drag video started');
        if (stateName === 'DROP') console.log('[Assistant Drag] drop animation started');
        return;
      }

      this.loadAnimationVideo(nextVideo, src, true);
      await playReady(nextVideo);

      nextVideo.classList.add('active');
      currentVideo.classList.remove('active');
      try { currentVideo.pause(); } catch (_) {}
      this.activeVideoEl = nextVideo;
      this.inactiveVideoEl = currentVideo;

      if (stateName === 'DRAG') console.log('[Assistant Drag] drag video started:', nextVideo.currentSrc || src);
      if (stateName === 'DROP') console.log('[Assistant Drag] drop animation started:', nextVideo.currentSrc || src);
    } catch (err) {
      console.warn(`[Assistant Drag] Video play/load error for ${stateName}:`, err);
      // DROP must not get stuck if the asset is unavailable. The error handler
      // returns to the normal assistant state and reports the actual asset path.
      if (stateName === 'DROP' || stateName === 'DRAG') {
        this.displayBubbleText?.(`Animation video load nahi hua: ${src}`);
        const fallback = this.getActiveAIState();
        if (this.currentState === stateName) this.setState(fallback);
      }
    }
  }

  // Initial greeting startup flow
  startGreetingFlow() {
    if (this.hasGreeted) return;
    this.hasGreeted = true;

    this.setState('HELLO');
    const currentName = this.aiIdentity?.name || this.config.assistantName || 'Aoi';
    const greeting = `Hi! I am ${currentName}. How can I help you?`;
    this.speakResponse(greeting, 'hello');
    this.greetingAudioPlayed = true;
    // Start the always-ready listener after the first browser interaction unlocks the microphone.
    // Voice starts only when the user presses the microphone button.
  }

  // Drag-and-Drop Implementation with robust Pointer Events.
  // The avatar follows the pointer; releasing it triggers the existing DROP state.
  initDragAndDrop() {
    const root = this.dom.root;
    const handle = this.dom.avatarWrapper;
    if (!root || !handle || handle.dataset.dragBound === '1') return;
    handle.dataset.dragBound = '1';

    let activePointerId = null;
    let pointerStart = null;
    let elementStart = null;
    let moved = false;

    const cleanup = () => {
      if (activePointerId !== null) {
        try { handle.releasePointerCapture(activePointerId); } catch (_) {}
      }
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      activePointerId = null;
      pointerStart = null;
      elementStart = null;
    };

    const onPointerDown = (e) => {
      if (activePointerId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, input, textarea, form, a, .assistant-speech-bubble')) return;

      const rect = root.getBoundingClientRect();
      activePointerId = e.pointerId;
      pointerStart = { x: e.clientX, y: e.clientY };
      elementStart = { x: rect.left, y: rect.top };
      moved = false;
      this.isDragging = false;
      this.hasMovedPastThreshold = false;

      handle.style.touchAction = 'none';
      root.style.touchAction = 'none';
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}

      document.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
      document.addEventListener('pointerup', onPointerUp, { passive: false, capture: true });
      document.addEventListener('pointercancel', onPointerUp, { passive: false, capture: true });
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMove = (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId || !pointerStart || !elementStart) return;
      const dx = e.clientX - pointerStart.x;
      const dy = e.clientY - pointerStart.y;

      if (!moved) {
        if (Math.hypot(dx, dy) < this.dragThreshold) return;
        moved = true;
        this.isDragging = true;
        this.hasMovedPastThreshold = true;
        root.classList.add('is-dragging');
        this.setState('DRAG');
      }

      e.preventDefault();
      e.stopPropagation();

      const rect = root.getBoundingClientRect();
      const maxX = Math.max(10, window.innerWidth - rect.width - 10);
      const maxY = Math.max(10, window.innerHeight - rect.height - 10);
      const targetX = Math.max(10, Math.min(elementStart.x + dx, maxX));
      const targetY = Math.max(10, Math.min(elementStart.y + dy, maxY));

      root.style.left = `${targetX}px`;
      root.style.top = `${targetY}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    };

    const onPointerUp = (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const didDrag = moved || this.isDragging || this.hasMovedPastThreshold;
      cleanup();

      if (didDrag) {
        this.isDragging = false;
        this.hasMovedPastThreshold = true;
        root.classList.remove('is-dragging');
        this.setState('DROP');
        // Prevent the avatar click handler from immediately toggling the chat after a drag.
        this.suppressAvatarClick = true;
        setTimeout(() => { this.hasMovedPastThreshold = false; }, 80);
      } else {
        this.isDragging = false;
        this.hasMovedPastThreshold = false;
      }
    };

    handle.addEventListener('pointerdown', onPointerDown, { passive: false });
    handle.addEventListener('dragstart', (e) => e.preventDefault());
  }


  // ==========================================
  // PHASE 12: VOICE MANAGER & SPEECH SYSTEM
  // ==========================================
  initVoiceManager() {
    this.checkMicrophonePermission();
    this.initSpeechRecognition();
  }

  async checkMicrophonePermission() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        this.voiceManager.permissionState = result.state;
        result.onchange = () => {
          this.voiceManager.permissionState = result.state;
          console.log('[VoiceManager] Microphone permission state changed to:', result.state);
        };
      } catch (_) {
        // Permissions query not supported for microphone in some browsers
      }
    }
  }

  // Central Browser Audio Manager & Speech Cancellation
  stopCurrentAudio() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
      } catch (_) {}
      this.currentAudio = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    this.voiceManager.isSpeaking = false;
    this.isSpeakingNow = false;
  }

  // Speak response with natural flow, echo protection, and animation sync
  speakResponse(text, voiceKey = null, isSuccessAction = false) {
    this.displayBubbleText(text);

    // Refresh conversational context window on every AI response
    this.refreshConversationContext();

    if (this.isMuted) {
      if (isSuccessAction) this.setState('DONE');
      else if (this.currentState !== 'HELLO') this.setState('IDLE');
      return;
    }

    this.stopCurrentAudio();
    this.playSpeechSynthesis(text, isSuccessAction);
  }

  playSpeechSynthesis(text, isSuccessAction) {
    if (!("speechSynthesis" in window)) {
      if (isSuccessAction) this.setState('DONE');
      else this.setState('IDLE');
      return;
    }

    this.setState('SPEAK');
    this.voiceManager.isSpeaking = true;
    this.isSpeakingNow = true;

    const utterance = new SpeechSynthesisUtterance(text);
    const tts = { pitch: 1.18, rate: 1.02, volume: 1, lang: 'en-IN' };
    utterance.pitch = tts.pitch;
    utterance.rate = tts.rate;
    utterance.volume = tts.volume;
    utterance.lang = tts.lang;

    const chooseVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const preferred = ['Microsoft Zira','Google UK English Female','Samantha','Heera','Raveena','Neerja'];
      const preferredMatch = voices.find(v => preferred.some(name => v.name.toLowerCase().includes(name.toLowerCase())));
      const femaleMatch = voices.find(v => /female|zira|samantha|google uk english female|heera|kalpana|raveena|neerja/i.test(v.name));
      const langMatch = voices.find(v => (v.lang || '').toLowerCase().startsWith((tts.lang || 'en-IN').toLowerCase().split('-')[0]));
      utterance.voice = preferredMatch || femaleMatch || langMatch || voices[0];
    };

    chooseVoice();
    if (window.speechSynthesis.onvoiceschanged === null) {
      window.speechSynthesis.onvoiceschanged = chooseVoice;
    }

    utterance.onstart = () => {
      this.voiceManager.isSpeaking = true;
      this.isSpeakingNow = true;
      this.currentAudio = { pause: () => window.speechSynthesis.cancel(), currentTime: 0 };
      this.setState('SPEAK');
    };

    utterance.onend = () => {
      this.voiceManager.isSpeaking = false;
      this.isSpeakingNow = false;
      this.currentAudio = null;
      if (isSuccessAction) this.setState('DONE');
      else this.setState('IDLE');

      // If voice enabled, safely resume recognition for conversational follow-ups
      if (this.voiceEnabled && !this.isMuted && this.voiceManager.wakeArmed) {
        setTimeout(() => this.startAlwaysListening(), 250);
      }
    };

    utterance.onerror = (e) => {
      console.warn('[VoiceManager] Speech synthesis error/cancelled:', e);
      this.voiceManager.isSpeaking = false;
      this.isSpeakingNow = false;
      this.currentAudio = null;
      if (isSuccessAction) this.setState('DONE');
      else this.setState('IDLE');

      if (this.voiceEnabled && !this.isMuted && this.voiceManager.wakeArmed) {
        setTimeout(() => this.startAlwaysListening(), 250);
      }
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  // Smooth typewriter text in speech bubble
  displayBubbleText(fullText) {
    if (!this.dom.bubbleText) return;
    if (this.typingTimer) clearInterval(this.typingTimer);

    const el = this.dom.bubbleText;
    el.textContent = '';
    let index = 0;

    this.typingTimer = setInterval(() => {
      if (index < fullText.length) {
        el.textContent += fullText.charAt(index);
        index++;
      } else {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
      }
    }, 16);
  }

  // Speech Recognition (Phase 12 Single-Instance Lifecycle & Echo Protection)
  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VoiceManager] SpeechRecognition is not supported in this browser.');
      return;
    }

    if (this.voiceManager.recognition) {
      return; // Prevent duplicate instantiation
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true; // Enabled for prompt interruption
      recognition.lang = 'en-IN';

      recognition.onstart = () => {
        this.voiceManager.isListening = true;
        this.isListening = true;
        this.dom.micBtn?.classList.add('recording', 'voice-toggle-on');
        this.dom.micBtn?.classList.remove('voice-toggle-off');
        if (this.dom.micLabel) this.dom.micLabel.textContent = '';
        if (this.dom.micIcon) this.dom.micIcon.textContent = 'mic';
      };

      recognition.onresult = (event) => {
        // Interruption & Echo Handling
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim();
          if (!transcript) continue;

          // Rule 33 & 34: Interruption check ("stop", "ruk jao", "bas", "cancel")
          const lowText = transcript.toLowerCase();
          if (this.voiceManager.isSpeaking || this.currentState === 'SPEAK') {
            if (/\b(stop|ruk jao|bas|cancel|shant|chup)\b/i.test(lowText)) {
              console.log('[VoiceManager] Interruption detected: stopping current speech.');
              this.stopCurrentAudio();
              this.setState('IDLE');
              this.displayBubbleText('Stopped.');
              return;
            }
            // Echo protection: Ignore other recognized audio while AI is speaking
            return;
          }

          // Only process final results as commands
          if (event.results[i].isFinal) {
            console.log('[VoiceManager] Final voice transcript:', transcript);
            this.handleVoiceTranscript(transcript);
          }
        }
      };

      recognition.onerror = (event) => {
        console.warn('[VoiceManager] Recognition event error:', event.error);
        this.voiceManager.isListening = false;
        this.isListening = false;
        this.dom.micBtn?.classList.remove('recording');

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.voiceManager.permissionState = 'denied';
          this.displayBubbleText('Microphone permission denied. Browser settings se microphone allow karein.');
          this.setState('ERROR');
          setTimeout(() => { if (this.currentState === 'ERROR') this.setState('IDLE'); }, 2000);
          return;
        }

        if (event.error === 'no-speech') {
          // Normal silence, safely restart if enabled
          this.restartRecognitionSafely(300);
          return;
        }

        if (this.voiceEnabled && !this.isMuted) {
          this.restartRecognitionSafely(1000);
        }
      };

      recognition.onend = () => {
        this.voiceManager.isListening = false;
        this.isListening = false;
        this.dom.micBtn?.classList.remove('recording');

        // Rule 23: Safe restart when voice is ON and not speaking
        if (this.voiceEnabled && !this.isMuted && !this.voiceManager.isSpeaking && this.voiceManager.wakeArmed) {
          this.restartRecognitionSafely(400);
        }
      };

      this.voiceManager.recognition = recognition;
      this.speechRecognition = recognition;
    } catch (e) {
      console.warn('[VoiceManager] Speech recognition init failed:', e);
    }
  }

  toggleMicrophone() {
    if (!this.speechRecognition) {
      this.initSpeechRecognition();
    }
    if (!this.speechRecognition) {
      this.displayBubbleText('Voice recognition is not supported. Chrome/Edge mein microphone allow karein.');
      return;
    }
    if (this.voiceManager.isListening) {
      try { this.speechRecognition.stop(); } catch (_) {}
      this.voiceEnabled = false;
      this.voiceManager.wakeArmed = false;
      this.wakeArmed = false;
      this.dom.micBtn?.classList.remove('recording');
      this.setState('IDLE');
      this.displayBubbleText('Voice listening OFF.');
      return;
    }
    this.voiceEnabled = true;
    this.voiceManager.wakeArmed = true;
    this.wakeArmed = true;
    this.setState('LISTEN');
    this.displayBubbleText('I am listening...');
    try {
      this.speechRecognition.start();
    } catch (err) {
      console.warn('[VoiceManager] start failed:', err);
      this.displayBubbleText('Microphone start nahi hua. Browser microphone permission check karein.');
    }
  }

  restartRecognitionSafely(delayMs = 400) {
    if (this.voiceManager.restartTimer) {
      clearTimeout(this.voiceManager.restartTimer);
    }
    this.voiceManager.restartTimer = setTimeout(() => {
      if (this.voiceEnabled && !this.isMuted && !this.voiceManager.isListening && !this.voiceManager.isSpeaking) {
        this.startAlwaysListening();
      }
    }, delayMs);
  }

  // Phase 12: Conversational Context Window Tracking (Rule 29, 30, 31)
  refreshConversationContext() {
    this.voiceManager.contextActive = true;
    if (this.voiceManager.contextTimer) {
      clearTimeout(this.voiceManager.contextTimer);
    }
    // Context stays active for 15 seconds after last AI response for seamless follow-up
    this.voiceManager.contextTimer = setTimeout(() => {
      this.voiceManager.contextActive = false;
      this.voiceManager.wakeArmed = false;
      console.log('[VoiceManager] Conversation context window expired. Wake word required again.');
    }, 15000);
  }

  // Handle incoming voice transcript with wake-word strip, silence timeout, and follow-up support
  handleVoiceTranscript(transcript) {
    const rawText = transcript.trim();
    if (!rawText) return;

    const normalized = rawText.toLowerCase().replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ').trim();

    // Check interruption / cancellation keywords
    if (/\b(cancel|ruk jao|stop task|cancel task)\b/i.test(normalized)) {
      this.wakeArmed = false;
      this.voiceManager.wakeArmed = false;
      clearTimeout(this.wakeListeningTimer);
      clearTimeout(this.voiceManager.wakeTimer);
      this.setState('IDLE');
      this.displayBubbleText('Task cancelled.');
      return;
    }

    // Configured list of wake phrases
    const configuredWakeWords = this.config.wakeWords || [
      "hey smart school", "smart school", "hello smart school",
      "hey aoi", "aoi", "hello aoi", "jarvis"
    ];

    let matchedWake = null;
    for (const phrase of configuredWakeWords) {
      const normPhrase = phrase.toLowerCase().trim();
      if (normalized.startsWith(normPhrase) || normalized.includes(normPhrase)) {
        matchedWake = normPhrase;
        break;
      }
    }

    // Case 1: Active conversation context window or wake-armed
    if (this.voiceManager.wakeArmed || this.wakeArmed || this.voiceManager.contextActive) {
      clearTimeout(this.voiceManager.wakeTimer);
      clearTimeout(this.wakeListeningTimer);
      this.voiceManager.wakeArmed = false;
      this.wakeArmed = false;

      // Strip wake word if present in utterance
      let cmdText = rawText;
      if (matchedWake) {
        const wakeIdx = normalized.indexOf(matchedWake);
        cmdText = rawText.substring(wakeIdx + matchedWake.length).replace(/^[,.:;\s]+/, '').trim();
      }

      if (cmdText && cmdText.length >= 2) {
        this.handleUserCommand(cmdText);
        return;
      }
    }

    // Case 2: Wake phrase detected in transcript
    if (matchedWake) {
      // Find remaining command in the same utterance (Rule 5: Wake Word Removal)
      // e.g. "Hey Smart School classroom light on karo" -> "classroom light on karo"
      const wakeIdx = normalized.indexOf(matchedWake);
      const afterWake = rawText.substring(wakeIdx + matchedWake.length).replace(/^[,.:;\s]+/, '').trim();

      if (afterWake && afterWake.length >= 2) {
        // Immediate same-utterance command execution
        this.setState('LISTEN');
        setTimeout(() => this.handleUserCommand(afterWake), 100);
      } else {
        // Pause-then-command mode: Arm active listening with silence timeout (Rule 8)
        this.voiceManager.wakeArmed = true;
        this.wakeArmed = true;
        this.setState('LISTEN');
        this.displayBubbleText('Yes? I am listening.');

        const timeoutMs = this.config.wakeWordTimeoutMs || 7000;
        clearTimeout(this.voiceManager.wakeTimer);
        clearTimeout(this.wakeListeningTimer);
        this.voiceManager.wakeTimer = setTimeout(() => {
          this.voiceManager.wakeArmed = false;
          this.wakeArmed = false;
          if (this.currentState === 'LISTEN') {
            console.log('[VoiceManager] Listen timeout: Returning to IDLE.');
            this.setState('IDLE');
          }
        }, timeoutMs);
        this.wakeListeningTimer = this.voiceManager.wakeTimer;
      }
    }
  }

  startAlwaysListening() {
    if (!this.speechRecognition || !this.voiceEnabled || this.isMuted || this.voiceManager.isListening || this.voiceManager.isSpeaking) return;
    try {
      this.speechRecognition.start();
    } catch (_) {}
  }

  scheduleAlwaysListening() {
    const start = () => {
      if (this.voiceEnabled) this.startAlwaysListening();
      document.removeEventListener('click', start);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('keydown', start);
    };
    document.addEventListener('click', start, { once: true });
    document.addEventListener('touchstart', start, { once: true });
    document.addEventListener('keydown', start, { once: true });
  }

  setAIName(newName, persist = true) {
    if (!newName || !newName.trim()) return;
    const cleanName=newName.trim();
    this.aiIdentity.name=cleanName;
    window.aiIdentity=this.aiIdentity;
    this.config.assistantName=cleanName;
    this.wakeWord=cleanName.toLowerCase();
    this.updateAssistantIdentityUI();
    if(persist) localStorage.setItem('smartSchoolAISettings',JSON.stringify({assistantName:cleanName}));
  }

  openAICustomizer() {
    if (typeof isAdminLoggedIn === 'function' && !isAdminLoggedIn()) {
      if (typeof openAuth === 'function') openAuth('customize');
      else this.displayBubbleText('AI Customize Mode ke liye admin login required hai.');
      return;
    }

    let panel = document.getElementById('aiCustomizerPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'aiCustomizerPanel';
      panel.className = 'ai-customizer-panel';
      document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    this.buildAICustomizer(panel);
    this.refreshManualSkills(panel);
  }

  buildAICustomizer(panel) {
    panel.innerHTML = `
      <div class="ai-customizer-backdrop"></div>
      <div class="ai-customizer-card">
        <div class="ai-customizer-head">
          <div><strong>⚙ AI CUSTOMIZE</strong><small>AI name aur manual workflows configure karo.</small></div>
          <button type="button" id="aiCustomizerClose" aria-label="Close">×</button>
        </div>

        <div class="ai-customizer-grid">
          <label class="wide">AI NAME
            <input id="aiSetName" placeholder="Ronit" autocomplete="off">
          </label>
        </div>

        <div class="ai-customizer-note">Yahan code likhne ki zarurat nahi. Pehle CREATE MANUAL WORKFLOW dabao, phir trigger aur actions set karke SAVE WORKFLOW karo.</div>

        <div class="workflow-builder">
          <button type="button" class="workflow-builder-title" id="wfCreateBtn">＋ CREATE MANUAL WORKFLOW</button>
          <div id="wfEditor" hidden>
            <div class="wf-editor-grid">
              <label>WORKFLOW NAME<input id="wfName" class="ai-inline-input" placeholder="Open Chrome"></label>
              <label>TRIGGER / COMMAND<input id="wfTrigger" class="ai-inline-input" placeholder="open chrome"></label>
            </div>
            <div class="wf-action-row">
              <select id="wfDevice" class="ai-inline-input" aria-label="Device"></select>
              <select id="wfAction" class="ai-inline-input" aria-label="Action"></select>
              <input id="wfValue" class="ai-inline-input" placeholder="Value / target">
              <button type="button" class="ai-q-btn secondary" id="wfPickMouse" hidden>🖱️ PICK POSITION</button>
              <button type="button" class="ai-q-btn" id="wfAdd">＋ ADD ACTION</button>
            </div>
            <div id="wfActionHint" class="wf-action-hint"></div>
            <div id="wfRecorder" class="wf-recorder" hidden>
              <div class="wf-recorder-head"><strong>🖥️ PC ACTION RECORDER</strong><span id="wfRecordStatus">READY</span></div>
              <div class="wf-recorder-controls">
                <button type="button" class="ai-q-btn" id="wfRecordStart">🔴 START RECORDING</button>
                <button type="button" class="ai-q-btn danger" id="wfRecordStop" disabled>⏹ STOP RECORDING</button>
                <button type="button" class="ai-q-btn secondary" id="wfRecordCancel" disabled>CANCEL</button>
              </div>
              <div class="wf-recorder-stats">Recorded Actions: <b id="wfRecordCount">0</b></div>
              <div class="wf-recorder-position">Mouse Position: <b id="wfMouseX">—</b>, <b id="wfMouseY">—</b></div>
              <div class="wf-recorder-note">START ke baad PC par jo mouse click/scroll aur keyboard actions karoge, woh capture honge. STOP ke baad actions neeche workflow me aa jayenge.</div>
            </div>
            <div id="wfSteps" class="wf-steps"></div>
            <div class="ai-inline-actions">
              <button type="button" class="ai-q-btn" id="wfSave">SAVE WORKFLOW</button>
              <button type="button" class="ai-q-btn secondary" id="wfCancel">CANCEL</button>
              <button type="button" class="ai-q-btn secondary" id="wfClear">CLEAR</button>
            </div>
          </div>
        </div>

        <div class="ai-customizer-qa-list" id="aiSkillList"></div>
        <div class="ai-customizer-actions">
          <button type="button" id="aiSetSave">SAVE AI NAME</button>
          <button type="button" id="aiSetReset">RESET AI NAME</button>
          <button type="button" id="aiSetClose2">CLOSE</button>
        </div>
      </div>`;

    const close = () => { panel.style.display = 'none'; };
    panel.querySelector('#aiCustomizerClose').onclick = close;
    panel.querySelector('#aiSetClose2').onclick = close;
    panel.querySelector('.ai-customizer-backdrop').onclick = close;

    const deviceOptions = [
      ['pc', 'PC ACTIONS'],
      ['browser', 'BROWSER'],
      ['recorder', 'RECORDER'],
      ['arduino', 'ARDUINO']
    ];
    const actionMap = {
      pc: [
        ['open_app','Open Application','App name: Chrome / This PC / Calculator / Notepad'],
        ['close_app','Close Application','App name, e.g. chrome'],
        ['open_file','Open File','Full path inside your user folder'],
        ['open_folder','Open Folder','downloads / documents / desktop / pictures / videos / music'],
        ['wait','Wait','Seconds, e.g. 2'],
        ['type_text','Type Text','Text to type'],
        ['press_key','Press Key','Key, e.g. enter'],
        ['hotkey','Hotkey','Keys, e.g. ctrl+shift+s'],
        ['enter','Enter','No value'],['tab','Tab','No value'],['escape','Escape','No value'],
        ['copy','Copy','No value'],['paste','Paste','No value'],
        ['move_mouse','Move Mouse','x,y'],['left_click','Left Click','No value'],['right_click','Right Click','No value'],['double_click','Double Click','No value'],
        ['scroll_up','Scroll Up','No value'],['scroll_down','Scroll Down','No value']
      ],
      browser: [
        ['open_website','Open Website','Website name or URL'],['open_url','Open URL','https://...'],
        ['new_tab','New Tab','No value'],['close_tab','Close Tab','No value'],['refresh','Refresh','No value'],['back','Back','No value'],['forward','Forward','No value']
      ],
      recorder: [
        ['recorder_start','START RECORDING','No value'],
        ['recorder_stop','STOP RECORDING','No value']
      ],
      arduino: [
        ['digital_on','Digital Pin ON','light / fan1 / fan2 / buzzer / pump'],['digital_off','Digital Pin OFF','light / fan1 / fan2 / buzzer / pump'],
        ['servo_angle','Servo Angle','0-180'],['motor_on','Motor ON','fan1 / fan2'],['motor_off','Motor OFF','fan1 / fan2'],['read_sensor','Read Sensor','No value'],
        ['light_on','Classroom Light ON','No value'],['light_off','Classroom Light OFF','No value'],['fan1_on','Fan 1 ON','No value'],['fan1_off','Fan 1 OFF','No value'],
        ['fan2_on','Fan 2 ON','No value'],['fan2_off','Fan 2 OFF','No value'],['gate_open','Gate OPEN','No value'],['gate_close','Gate CLOSE','No value'],
        ['buzzer_on','Buzzer ON','No value'],['buzzer_off','Buzzer OFF','No value'],['pump_on','Pump ON','No value'],['pump_off','Pump OFF','No value'],['counter_reset','Counter RESET','No value']
      ]
    };

    const deviceSelect = panel.querySelector('#wfDevice');
    const actionSelect = panel.querySelector('#wfAction');
    const valueInput = panel.querySelector('#wfValue');
    const editor = panel.querySelector('#wfEditor');
    const hint = panel.querySelector('#wfActionHint');
    let editingId = null;
    let steps = [];

    // Keep these controls native and independently interactive. IMPORTANT: do not
    // rebuild a <select> from its own focus/click handler. Doing so replaces its
    // <option> nodes while Chrome's native menu is opening, which immediately closes
    // the menu and makes it look like the user cannot select anything.
    deviceSelect.innerHTML = deviceOptions.map(([v,t]) => `<option value="${v}">${t}</option>`).join('');
    deviceSelect.value = 'pc';

    const currentActionMeta = () => {
      const list = actionMap[deviceSelect.value] || [];
      return list.find(x => x[0] === actionSelect.value) || list[0];
    };
    const updateActions = () => {
      const isRecorder = deviceSelect.value === 'recorder';
      const list = actionMap[deviceSelect.value] || [];
      actionSelect.innerHTML = list.map(([v,t]) => `<option value="${v}">${t}</option>`).join('');
      const meta = currentActionMeta();
      valueInput.placeholder = meta?.[2] || 'Value / target';
      const noValue = ['wait'].includes(actionSelect.value) === false && [
        'enter','tab','escape','copy','paste','left_click','right_click','double_click','scroll_up','scroll_down',
        'new_tab','close_tab','refresh','back','forward','press_home','press_back','read_sensor',
        'light_on','light_off','fan1_on','fan1_off','fan2_on','fan2_off','gate_open','gate_close','buzzer_on','buzzer_off','pump_on','pump_off','counter_reset',
        'recorder_start','recorder_stop'
      ].includes(actionSelect.value);
      valueInput.style.display = isRecorder || noValue ? 'none' : '';
      const picker = panel.querySelector('#wfPickMouse');
      if (picker) picker.hidden = isRecorder || actionSelect.value !== 'move_mouse';
      hint.textContent = isRecorder ? 'Recorder mode: Start/Stop se real PC actions capture honge.' : (meta ? `Selected: ${meta[1]} • ${meta[2]}` : '');
      const recorder = panel.querySelector('#wfRecorder');
      if (recorder) recorder.hidden = !isRecorder;
      const row = panel.querySelector('.wf-action-row');
      if (row) row.style.display = isRecorder ? 'none' : '';
    };
    // Only rebuild the ACTION select after the DEVICE selection has actually
    // changed. Rebuilding on focus/input/click destroys the native dropdown popup
    // before the user can choose an option.
    const refreshActionControl = () => updateActions();
    deviceSelect.addEventListener('change', refreshActionControl);
    actionSelect.addEventListener('change', () => {
      const meta = currentActionMeta();
      valueInput.placeholder = meta?.[2] || 'Value / target';
      const noValue = ['wait'].includes(actionSelect.value) === false && [
        'enter','tab','escape','copy','paste','left_click','right_click','double_click','scroll_up','scroll_down',
        'new_tab','close_tab','refresh','back','forward','press_home','press_back','read_sensor',
        'light_on','light_off','fan1_on','fan1_off','fan2_on','fan2_off','gate_open','gate_close',
        'buzzer_on','buzzer_off','pump_on','pump_off','counter_reset'
      ].includes(actionSelect.value);
      valueInput.style.display = noValue ? 'none' : '';
      hint.textContent = meta ? `Selected: ${meta[1]} • ${meta[2]}` : '';
    });
    updateActions();

    const renderSteps = () => {
      panel.querySelector('#wfSteps').innerHTML = steps.length
        ? steps.map((x,i) => `<div class="wf-step"><span>${i+1}. ${this.escapeHTML(x.label)}</span><button type="button" data-rm="${i}" aria-label="Remove action">×</button></div>`).join('')
        : '<div class="ai-mini-empty">No actions added yet.</div>';
    };

    const resetEditor = () => {
      stopMousePicker();
      if (recorderBusy) { fetch(`${recorderBase()}/api/recorder/cancel`, {method:'POST'}).catch(()=>{}); recorderBusy=false; stopRecorderPoll(); }
      editingId = null;
      steps = [];
      panel.querySelector('#wfName').value = '';
      panel.querySelector('#wfTrigger').value = '';
      valueInput.value = '';
      panel.querySelector('#wfSave').textContent = 'SAVE WORKFLOW';
      editor.hidden = true;
      renderSteps();
    };

    const startCreate = () => {
      editingId = null;
      steps = [];
      panel.querySelector('#wfName').value = '';
      panel.querySelector('#wfTrigger').value = '';
      valueInput.value = '';
      panel.querySelector('#wfSave').textContent = 'SAVE WORKFLOW';
      editor.hidden = false;
      panel.querySelector('#wfName').focus();
      renderSteps();
    };

    panel.querySelector('#wfCreateBtn').onclick = startCreate;
    panel.querySelector('#wfCancel').onclick = resetEditor;
    panel.querySelector('#wfClear').onclick = () => { steps=[]; renderSteps(); };
    panel.querySelector('#wfSteps').onclick = (e) => {
      const btn = e.target.closest('[data-rm]');
      if (!btn) return;
      steps.splice(Number(btn.dataset.rm), 1);
      renderSteps();
    };

    let recorderBusy = false;
    let recorderPoll = null;
    const recordStatus = panel.querySelector('#wfRecordStatus');
    const recordCount = panel.querySelector('#wfRecordCount');
    const recordStart = panel.querySelector('#wfRecordStart');
    const recordStop = panel.querySelector('#wfRecordStop');
    const recordCancel = panel.querySelector('#wfRecordCancel');
    const mouseX = panel.querySelector('#wfMouseX');
    const mouseY = panel.querySelector('#wfMouseY');
    const recorderBase = () => this.config.apiBaseUrl || 'http://127.0.0.1:8000';
    const pickMouseBtn = panel.querySelector('#wfPickMouse');
    let mousePickerTimer = null;
    let mousePickerActive = false;
    const stopMousePicker = () => { if (mousePickerTimer) { clearInterval(mousePickerTimer); mousePickerTimer=null; } mousePickerActive=false; if (pickMouseBtn) pickMouseBtn.textContent='🖱️ PICK POSITION'; };
    const startMousePicker = () => {
      if (mousePickerActive) {
        const x=mouseX.textContent, y=mouseY.textContent;
        if (x !== '—' && y !== '—') valueInput.value=`${x},${y}`;
        stopMousePicker(); return;
      }
      mousePickerActive=true; pickMouseBtn.textContent='⏎ PRESS ENTER / USE POSITION';
      mousePickerTimer=setInterval(async()=>{
        try { const r=await fetch(`${recorderBase()}/api/recorder/mouse-position`,{cache:'no-store'}); const d=await r.json(); if(d?.success){mouseX.textContent=d.x;mouseY.textContent=d.y;} } catch(_){}
      },100);
    };
    if (pickMouseBtn) pickMouseBtn.onclick = startMousePicker;
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && mousePickerActive && document.activeElement !== valueInput) {
        e.preventDefault(); const x=mouseX.textContent, y=mouseY.textContent; if(x !== '—' && y !== '—') valueInput.value=`${x},${y}`; stopMousePicker();
      }
    });
    const setRecorderUI = (active, count=0) => {
      recordStatus.textContent = active ? '● RECORDING' : 'READY';
      recordStatus.classList.toggle('recording', active);
      recordStart.disabled = active; recordStop.disabled = !active; recordCancel.disabled = !active;
      recordCount.textContent = String(count);
    };
    const stopRecorderPoll = () => { if (recorderPoll) { clearInterval(recorderPoll); recorderPoll=null; } };
    const startRecorderPoll = () => {
      stopRecorderPoll();
      recorderPoll = setInterval(async () => {
        try {
          const [st, mp] = await Promise.all([fetch(`${recorderBase()}/api/recorder/status`, {cache:'no-store'}), fetch(`${recorderBase()}/api/recorder/mouse-position`, {cache:'no-store'})]);
          const sd = await st.json();
          if (sd?.recording) recordCount.textContent = String(sd.count || 0);
          const md = await mp.json();
          if (md?.success) { mouseX.textContent=md.x; mouseY.textContent=md.y; }
        } catch (_) {}
      }, 150);
    };
    recordStart.onclick = async () => {
      if (recorderBusy) return;
      try {
        const r = await fetch(`${recorderBase()}/api/recorder/start`, {method:'POST'});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || !d.success) throw new Error(d.response || `HTTP ${r.status}`);
        recorderBusy = true; setRecorderUI(true,0); startRecorderPoll();
        this.displayBubbleText('🔴 PC recording start ho gayi. Ab PC par actions karo.');
      } catch (e) { this.showWorkflowNotice(panel, `Recorder start failed: ${e.message}`, true); }
    };
    recordStop.onclick = async () => {
      if (!recorderBusy) return;
      try {
        const r = await fetch(`${recorderBase()}/api/recorder/stop`, {method:'POST'});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || !d.success) throw new Error(d.response || `HTTP ${r.status}`);
        recorderBusy = false; stopRecorderPoll(); setRecorderUI(false, d.count || 0);
        const captured = Array.isArray(d.actions) ? d.actions : [];
        if (!captured.length) {
          renderSteps();
          this.showWorkflowNotice(panel, 'Recording stop ho gayi, lekin koi PC action capture nahi hua. Backend/permission check karo.', true);
          return;
        }
        const mapped = captured.map(a => ({device:a.device||'pc', type:a.type, value:String(a.value||''), label:this.workflowActionLabel(a)}));
        steps.push(...mapped);
        renderSteps();
        this.showWorkflowNotice(panel, `✓ ${mapped.length} recorded actions workflow me add ho gaye.`, false);
        this.displayBubbleText(`${mapped.length} PC actions record hokar workflow me add ho gaye.`);
      } catch (e) { recorderBusy=false; stopRecorderPoll(); setRecorderUI(false,0); this.showWorkflowNotice(panel, `Recorder stop failed: ${e.message}`, true); }
    };
    recordCancel.onclick = async () => {
      if (!recorderBusy) return;
      try { await fetch(`${recorderBase()}/api/recorder/cancel`, {method:'POST'}); } catch (_) {}
      recorderBusy=false; stopRecorderPoll(); setRecorderUI(false,0); this.displayBubbleText('Recording cancel kar di gayi.');
    };

    panel.querySelector('#wfAdd').onclick = () => {
      const device = deviceSelect.value;
      const type = actionSelect.value;
      if (device === 'recorder') return;
      const value = valueInput.value.trim();
      const noValue = ['enter','tab','escape','copy','paste','left_click','right_click','double_click','scroll_up','scroll_down','new_tab','close_tab','refresh','back','forward','press_home','press_back','read_sensor','light_on','light_off','fan1_on','fan1_off','fan2_on','fan2_off','gate_open','gate_close','buzzer_on','buzzer_off','pump_on','pump_off','counter_reset'].includes(type);
      if (!noValue && !value) {
        this.displayBubbleText('Is action ke liye value/target chahiye.');
        valueInput.focus();
        return;
      }
      const meta = currentActionMeta();
      steps.push({device, type, value, label: `${meta?.[1] || type}${value ? ` → ${value}` : ''}`});
      valueInput.value = '';
      renderSteps();
    };

    panel.querySelector('#wfSave').onclick = async () => {
      const name = panel.querySelector('#wfName').value.trim();
      const trigger = panel.querySelector('#wfTrigger').value.trim();
      if (!name) { this.showWorkflowNotice(panel, 'Workflow name required hai.', true); return; }
      if (!trigger) { this.showWorkflowNotice(panel, 'Trigger / command required hai.', true); return; }
      if (!steps.length) { this.showWorkflowNotice(panel, 'Kam se kam ek action add karo.', true); return; }

      const payload = {name, trigger, enabled:true, actions:steps.map(x => ({device:x.device,type:x.type,value:x.value || ''}))};
      const oldId = editingId;
      const base = this.config.apiBaseUrl || 'http://127.0.0.1:8000';
      try {
        let response;
        if (oldId) {
          response = await fetch(`${base}/api/skills/${encodeURIComponent(oldId)}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        } else {
          response = await fetch(`${base}/api/skills`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        }
        if (!response.ok) {
          let detail = '';
          try { detail = (await response.json()).detail || ''; } catch (_) { detail = await response.text(); }
          throw new Error(detail || `HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!data?.success || !data?.data) throw new Error('Backend returned an invalid workflow response.');
        this.cacheManualSkills(data.data, oldId);
        this.showWorkflowNotice(panel, `✓ ${name} save ho gaya.`, false);
        this.displayBubbleText(`${name} save ho gaya.`);
        resetEditor();
        await this.refreshManualSkills(panel);
        return;
      } catch (err) {
        // The workflow remains usable even when the optional local backend is not running.
        // Store the exact workflow data locally and sync with the backend on a later refresh.
        console.error('[Workflow] Backend save failed; using local workflow storage:', err);
        const localItems = this.loadManualSkills();
        const item = {
          id: oldId || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ...payload,
          createdAt: oldId ? (localItems.find(x => x.id === oldId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          localOnly: true
        };
        const filtered = localItems.filter(x => x.id !== oldId && this.normalizeQuestion(x.trigger) !== this.normalizeQuestion(trigger));
        filtered.unshift(item);
        localStorage.setItem('smartSchoolManualSkills', JSON.stringify(filtered));
        this.showWorkflowNotice(panel, `✓ ${name} locally save ho gaya. Backend connect hone par sync ho jayega.`, false);
        this.displayBubbleText(`${name} locally save ho gaya.`);
        resetEditor();
        this.renderWorkflowBuilder(panel, filtered);
      }
    };

    panel.querySelector('#aiSetSave').onclick = () => {
      const n = panel.querySelector('#aiSetName').value.trim();
      if (!n) { this.displayBubbleText('AI name empty nahi ho sakta.'); return; }
      this.setAIName(n, true);
      this.displayBubbleText(`${this.aiIdentity.name} settings save ho gayi.`);
    };
    panel.querySelector('#aiSetReset').onclick = () => {
      localStorage.removeItem('smartSchoolAISettings');
      this.aiIdentity.name = this.config.aiIdentity?.name || 'Aoi';
      this.config.assistantName = this.aiIdentity.name;
      this.updateAssistantIdentityUI();
      panel.querySelector('#aiSetName').value = this.aiIdentity.name;
    };
    panel.querySelector('#aiSetName').value = this.aiIdentity.name;
    renderSteps();

    this._workflowUI = {
      panel,
      actionMap,
      loadForEdit: (item) => {
        editingId = item.id;
        steps = (item.actions || []).map(a => ({device:a.device,type:a.type,value:a.value || '',label:this.workflowActionLabel(a)}));
        panel.querySelector('#wfName').value = item.name || '';
        panel.querySelector('#wfTrigger').value = item.trigger || '';
        panel.querySelector('#wfSave').textContent = 'UPDATE WORKFLOW';
        editor.hidden = false;
        renderSteps();
      }
    };
  }

  workflowActionLabel(action) {
    const labels = {
      open_app:'Open Application', close_app:'Close Application', open_file:'Open File', open_folder:'Open Folder', wait:'Wait',
      type_text:'Type Text', press_key:'Press Key', hotkey:'Hotkey', enter:'Enter', tab:'Tab', escape:'Escape', copy:'Copy', paste:'Paste',
      move_mouse:'Move Mouse', left_click:'Left Click', right_click:'Right Click', double_click:'Double Click', scroll_up:'Scroll Up', scroll_down:'Scroll Down',
      open_website:'Open Website', open_url:'Open URL', new_tab:'New Tab', close_tab:'Close Tab', refresh:'Refresh', back:'Back', forward:'Forward',
      open_app:'Open App', press_home:'Press Home', press_back:'Press Back', tap:'Tap', swipe:'Swipe',
      recorder_start:'START RECORDING', recorder_stop:'STOP RECORDING',
      digital_on:'Digital Pin ON', digital_off:'Digital Pin OFF', servo_angle:'Servo Angle', motor_on:'Motor ON', motor_off:'Motor OFF', read_sensor:'Read Sensor',
      light_on:'Classroom Light ON', light_off:'Classroom Light OFF', fan1_on:'Fan 1 ON', fan1_off:'Fan 1 OFF', fan2_on:'Fan 2 ON', fan2_off:'Fan 2 OFF',
      gate_open:'Gate OPEN', gate_close:'Gate CLOSE', buzzer_on:'Buzzer ON', buzzer_off:'Buzzer OFF', pump_on:'Pump ON', pump_off:'Pump OFF', counter_reset:'Counter RESET'
    };
    return `${labels[action.type] || action.type}${action.value ? ` → ${action.value}` : ''}`;
  }

  cacheManualSkills(item, replaceId = null) {
    let items = this.loadManualSkills();
    if (replaceId) items = items.filter(x => x.id !== replaceId);
    items = [item, ...items.filter(x => this.normalizeQuestion(x.trigger) !== this.normalizeQuestion(item.trigger))];
    localStorage.setItem('smartSchoolManualSkills', JSON.stringify(items));
  }

  async refreshManualSkills(panel = document.getElementById('aiCustomizerPanel')) {
    try {
      const base = this.config.apiBaseUrl || 'http://127.0.0.1:8000';
      const response = await fetch(`${base}/api/skills`, {cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const backendItems = Array.isArray(data?.data) ? data.data : [];
      // If a workflow was created while the backend was offline, sync it now.
      const localItems = this.loadManualSkills();
      const pending = localItems.filter(x => x && x.localOnly);
      for (const localItem of pending) {
        try {
          const payload = {name: localItem.name, trigger: localItem.trigger, enabled: localItem.enabled !== false, actions: (localItem.actions || []).map(a => ({device:a.device, type:a.type, value:a.value || ''}))};
          const syncResponse = await fetch(`${base}/api/skills`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
          if (syncResponse.ok) {
            const syncData = await syncResponse.json();
            if (syncData?.data) {
              const idx = localItems.findIndex(x => x.id === localItem.id);
              if (idx >= 0) localItems[idx] = syncData.data;
              backendItems.unshift(syncData.data);
            }
          }
        } catch (syncErr) {
          console.warn('[Workflow] Pending local workflow sync failed:', syncErr);
        }
      }
      // Backend is authoritative after successful synchronization.
      const unique = [];
      const seen = new Set();
      for (const item of backendItems) {
        const key = item.id || this.normalizeQuestion(item.trigger);
        if (!seen.has(key)) { seen.add(key); unique.push(item); }
      }
      localStorage.setItem('smartSchoolManualSkills', JSON.stringify(unique));
      if (panel) this.renderWorkflowBuilder(panel, unique);
    } catch (err) {
      console.warn('[Workflow] Backend list unavailable, using browser cache:', err);
      if (panel) this.renderWorkflowBuilder(panel, this.loadManualSkills());
    }
  }

  loadManualSkills() {
    try {
      const data = JSON.parse(localStorage.getItem('smartSchoolManualSkills') || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  }

  showWorkflowNotice(panel, message, isError = false) {
    if (!panel) return;
    let notice = panel.querySelector('#wfNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'wfNotice';
      notice.className = 'wf-notice';
      const editor = panel.querySelector('.workflow-builder');
      if (editor) editor.insertBefore(notice, editor.firstChild);
    }
    notice.textContent = message;
    notice.classList.toggle('error', !!isError);
    notice.hidden = false;
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { notice.hidden = true; }, 5000);
  }

  renderWorkflowBuilder(panel, suppliedItems = null) {
    const list = panel?.querySelector('#aiSkillList');
    if (!list) return;
    const items = suppliedItems || this.loadManualSkills();
    if (!items.length) {
      list.innerHTML = '<div class="ai-mini-empty">No manual workflows saved yet.</div>';
      return;
    }
    list.innerHTML = items.map((x) => {
      const enabled = x.enabled !== false;
      const actionText = (x.actions || []).map(a => this.workflowActionLabel(a)).join(' → ');
      return `<div class="ai-mini-qa" data-workflow-id="${this.escapeHTML(x.id || '')}">
        <div><b>${this.escapeHTML(x.name)}</b> <span class="wf-status ${enabled ? 'on' : 'off'}">${enabled ? 'ENABLED' : 'DISABLED'}</span></div>
        <div><b>TRIGGER:</b> ${this.escapeHTML(x.trigger)}</div>
        <div><b>ACTIONS:</b> ${this.escapeHTML(actionText || (x.steps || []).join(' → '))}</div>
        <div class="ai-mini-actions">
          <button type="button" class="ai-q-btn" data-edit="${this.escapeHTML(x.id || '')}">✎ EDIT</button>
          <button type="button" class="ai-q-btn" data-run="${this.escapeHTML(x.id || '')}">▶ TEST</button>
          <button type="button" class="ai-q-btn" data-toggle="${this.escapeHTML(x.id || '')}">${enabled ? '⏸ DISABLE' : '▶ ENABLE'}</button>
          <button type="button" class="ai-q-btn danger" data-del="${this.escapeHTML(x.id || '')}">🗑 DELETE</button>
        </div>
      </div>`;
    }).join('');

    list.onclick = async (e) => {
      const id = e.target.closest('[data-edit],[data-run],[data-toggle],[data-del]')?.dataset;
      if (!id) return;
      const item = this.loadManualSkills().find(x => x.id === id.edit || x.id === id.run || x.id === id.toggle || x.id === id.del);
      const base = this.config.apiBaseUrl || 'http://127.0.0.1:8000';
      try {
        if (id.edit) {
          if (!item) return;
          this._workflowUI?.loadForEdit(item);
          return;
        }
        if (id.run) {
          if (this._workflowTestBusy) {
            this.displayBubbleText('Workflow test already running hai. Pehle current test complete hone dein.');
            return;
          }
          this._workflowTestBusy = true;

          // A workflow can have been created while the backend was offline. In
          // that case the browser cache contains a localOnly workflow id that
          // does not exist in manual_skills.json yet, so /run correctly returns
          // 404. Sync that exact workflow first, then execute the backend id.
          let runId = id.run;
          let response = await fetch(`${base}/api/skills/${encodeURIComponent(runId)}/run`, {method:'POST'});
          let data = await response.json().catch(() => ({}));

          if (response.status === 404 && item?.localOnly) {
            const syncResponse = await fetch(`${base}/api/skills`, {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                name:item.name,
                trigger:item.trigger,
                enabled:item.enabled !== false,
                actions:(item.actions || []).map(a => ({device:a.device, type:a.type, value:a.value || ''}))
              })
            });
            const syncData = await syncResponse.json().catch(() => ({}));
            if (!syncResponse.ok || !syncData?.data?.id) {
              throw new Error(syncData?.detail || `Workflow backend sync failed (HTTP ${syncResponse.status})`);
            }
            runId = syncData.data.id;
            this.cacheManualSkills(syncData.data, item.id);
            response = await fetch(`${base}/api/skills/${encodeURIComponent(runId)}/run`, {method:'POST'});
            data = await response.json().catch(() => ({}));
          }

          if (!response.ok || !data.success) throw new Error(data.response || `Workflow execution failed (HTTP ${response.status})`);
          if (data.serial_command && typeof sendArduinoCommand === 'function') {
            for (const command of data.serial_command.split('\n').filter(Boolean)) await sendArduinoCommand(command);
          }
          this.speakResponse(`${item?.name || 'Workflow'} complete.`, 'success', true);
          this._workflowTestBusy = false;
          return;
        }
        if (id.toggle) {
          const response = await fetch(`${base}/api/skills/${encodeURIComponent(id.toggle)}/toggle`, {method:'POST'});
          if (!response.ok) throw new Error(await response.text());
          const data = await response.json();
          if (data.data) this.cacheManualSkills(data.data, id.toggle);
          await this.refreshManualSkills(panel);
          return;
        }
        if (id.del) {
          if (!confirm(`Delete workflow "${item?.name || 'this workflow'}"?`)) return;
          const response = await fetch(`${base}/api/skills/${encodeURIComponent(id.del)}`, {method:'DELETE'});
          if (!response.ok) throw new Error(await response.text());
          localStorage.setItem('smartSchoolManualSkills', JSON.stringify(this.loadManualSkills().filter(x => x.id !== id.del)));
          await this.refreshManualSkills(panel);
        }
      } catch (err) {
        this._workflowTestBusy = false;
        console.error('[Workflow] action failed:', err);
        this.displayBubbleText(`Workflow action failed: ${err.message || 'backend error'}`);
      }
    };
  }

  updateAssistantIdentityUI() {
    const name=this.aiIdentity?.name||this.config.assistantName||'Ronit';
    const headerEl=document.getElementById('assistantHeaderName');
    if(headerEl) headerEl.textContent=`✨ ${name} • AI Assistant`;
    if(this.dom?.bubbleText && !this.voiceManager.isSpeaking) this.dom.bubbleText.textContent=`Hi! I am ${name}. How can I help you?`;
    this.wakeWord=name.toLowerCase();
  }

  loadAISettings() {
    try {
      const saved=JSON.parse(localStorage.getItem('smartSchoolAISettings')||'null');
      if(saved?.assistantName){ this.aiIdentity.name=saved.assistantName; this.config.assistantName=saved.assistantName; }
    } catch(_) {}
  }


  // Interactive UI Event Listeners
  initEventListeners() {
    // Mic button
    this.dom.micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMicrophone();
    });

    // Speaker button: say a greeting using the current saved AI name.
    this.dom.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name=this.aiIdentity?.name||this.config.assistantName||'Ronit';
      this.speakResponse(`Hi! I am ${name}. How can I help you?`,'hello',false);
    });

    // Minimize / Expand button in speech bubble header
    this.dom.minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleChatBox();
    });

    // Text input submission
    this.dom.inputForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.dom.textInput.value.trim();
      if (!text) return;
      this.dom.textInput.value = '';
      this.handleUserCommand(text);
    });

    // AI Customize chip opens the manual workflow builder.
    document.getElementById('assistantAICustomizeBtn')?.addEventListener('click', (e) => { e.stopPropagation(); this.openAICustomizer(); });

    // Quick command chips
    this.dom.quickChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-btn');
      if (!chip) return;
      const cmd = chip.dataset.cmd;
      if (cmd) this.handleUserCommand(cmd);
    });

    // Tapping / Clicking the Anime AI Assistant Avatar toggles the chat box open/close
    this.dom.avatarWrapper.addEventListener('click', (e) => {
      if (this.suppressAvatarClick || this.isDragging || this.hasMovedPastThreshold) {
        e.preventDefault();
        e.stopPropagation();
        this.suppressAvatarClick = false;
        return;
      }
      this.toggleChatBox();
    });

    // Auto-maximize on interacting with text input, mic button, or quick chips
    this.dom.textInput.addEventListener('focus', () => {
      if (this.isMinimized) this.toggleChatBox();
    });
    this.dom.textInput.addEventListener('click', () => {
      if (this.isMinimized) this.toggleChatBox();
    });
    this.dom.quickChips?.addEventListener('click', () => {
      if (this.isMinimized) this.toggleChatBox();
    });
    this.dom.speechBubble?.addEventListener('click', (e) => {
      if (this.isMinimized && !e.target.closest('#assistantMinBtn')) {
        this.toggleChatBox();
      }
    });

    // Browser autoplay/microphone unlock: browsers require a user gesture at least once.
    // After that, speech output and the always-listening recognizer are kept ready.
    const unlockAudio = () => {
      if (!this.greetingAudioPlayed) {
        this.greetingAudioPlayed = true;
        const currentName = this.aiIdentity?.name || this.config.assistantName || 'Aoi';
        const greeting = `Hi! I am ${currentName}. How can I help you?`;
        this.speakResponse(greeting, 'hello', false);
      }
      if (this.voiceEnabled) this.startAlwaysListening();
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });
  }


  // Natural Language Command Processing & Hardware Bridge
  async handleUserCommand(rawInput) {
    const input = rawInput.toLowerCase().trim();
    console.log('[Assistant] Processing command:', input);

    // Auto-maximize if currently minimized when user sends a command
    if (this.isMinimized) {
      this.toggleChatBox();
    }

    this.setState('PROCESS');
    this.displayBubbleText(`Processing: "${rawInput}"...`);

    await new Promise(r => setTimeout(r, 350));

    // Natural Language AI Identity / Name Change Handling
    const nameChangePatterns = [
      /(?:tumhara|tera|aapka)\s+na+m\s+(?:aaj\s*se\s+|ab\s*se\s+)?(?:hai\s+)?([a-z0-9_\u0900-\u097f]+)/i,
      /(?:main\s+|hum\s+)?(?:tumhara|tera|aapka)\s+na+m\s+([a-z0-9_\u0900-\u097f]+)\s+(?:rakhta|rakhti|rakhte)\s+(?:hu|hoon|hai)/i,
      /(?:ab\s*se|aaj\s*se)\s+(?:tumhara|tera|aapka)\s+na+m\s+([a-z0-9_\u0900-\u097f]+)\s*(?:hai|hoga)?/i,
      /(?:change\s+(?:your\s+)?name\s+to|your\s+name\s+is\s+(?:now\s+|from\s+now\s+)?|call\s+yourself\s+|set\s+(?:your\s+)?name\s+to\s+)([a-z0-9_]+)/i
    ];

    for (const pattern of nameChangePatterns) {
      const match = rawInput.match(pattern);
      if (match && match[1]) {
        const candidateName = match[1].trim();
        const lowCandidate = candidateName.toLowerCase();
        if (!['kya', 'hai', 'batao', 'what', 'is', 'please', 'now', 'hai?'].includes(lowCandidate)) {
          const capitalizedName = candidateName.charAt(0).toUpperCase() + candidateName.slice(1);
          this.setAIName(capitalizedName, true);
          this.speakResponse(`Theek hai! Aaj se mera naam ${capitalizedName} hai. Main Smart School AI Assistant hoon.`, 'success', true);
          return;
        }
      }
    }

    // Direct Name Query Handling
    if (
      input.includes('tumhara naam kya hai') ||
      input.includes('tumhara name kya hai') ||
      input.includes('what is your name') ||
      input.includes('whats your name') ||
      input.includes('naam kya hai') ||
      input.includes('aapka naam')
    ) {
      const currentName = this.aiIdentity?.name || 'Aoi';
      this.speakResponse(`Mera naam ${currentName} hai. Main Smart School AI Assistant hoon.`, null, false);
      return;
    }

    if (
      input.includes('who are you') ||
      input.includes('tum kaun ho') ||
      input.includes('who r u')
    ) {
      const currentName = this.aiIdentity?.name || 'Aoi';
      this.speakResponse(`I am ${currentName}, the AI assistant for the Smart School Control Center.`, null, false);
      return;
    }

    // 1. LIVE TIME QUERY (Dynamic system time)
    if (
      input.includes('time') ||
      input.includes('kitna time') ||
      input.includes('time kya') ||
      input.includes('samay') ||
      input.includes('current time')
    ) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      const response = `The current time is ${timeStr}.`;
      this.speakResponse(response, null, false);
      return;
    }

    // 2. SMART SCHOOL STATUS QUERY
    if (
      input.includes('status') ||
      input.includes('kaun kaun se devices') ||
      input.includes('devices on') ||
      input.includes('system status') ||
      input.includes('kya kya on hai')
    ) {
      this.handleStatusQuery();
      return;
    }

    // 3. LIGHT CONTROLS
    if (input.includes('light') || input.includes('roshni')) {
      if (input.includes('on') || input.includes('chalu') || input.includes('start') || input.includes('jalao')) {
        await this.executeDeviceAction('light', 'on', 'lightOn', 'Classroom light is now turned ON.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop') || input.includes('bujhao')) {
        await this.executeDeviceAction('light', 'off', 'lightOff', 'Classroom light is now turned OFF.');
        return;
      }
    }

    // 4. BUZZER / BELL CONTROLS
    if (input.includes('buzzer') || input.includes('bell') || input.includes('ghanti')) {
      if (input.includes('on') || input.includes('ring') || input.includes('chalu') || input.includes('bajao') || input.includes('start')) {
        await this.executeDeviceAction('bell', 'ring', 'buzzerOn', 'The school buzzer is now ringing.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop') || input.includes('roko')) {
        await this.executeDeviceAction('bell', 'stop', 'buzzerOff', 'The school buzzer has been stopped.');
        return;
      }
    }

    // 5. GATE CONTROLS
    if (input.includes('gate') || input.includes('darwaza')) {
      if (input.includes('open') || input.includes('kholo') || input.includes('on') || input.includes('khul')) {
        await this.executeDeviceAction('gate', 'open', 'gateOpen', 'The school automatic gate is now OPEN.');
        return;
      }
      if (input.includes('close') || input.includes('band') || input.includes('off')) {
        await this.executeDeviceAction('gate', 'close', 'gateClose', 'The school gate is now CLOSED.');
        return;
      }
    }

    // 6. FAN CONTROLS
    if (input.includes('fan 1') || input.includes('fan1') || input.includes('motor 1') || input.includes('motor1')) {
      if (input.includes('on') || input.includes('chalu') || input.includes('start')) {
        await this.executeFanAction('fan1', true, 'fan1On', 'Classroom Fan 1 is now running.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop')) {
        await this.executeFanAction('fan1', false, 'fan1Off', 'Classroom Fan 1 is now turned OFF.');
        return;
      }
    }

    if (input.includes('fan 2') || input.includes('fan2') || input.includes('motor 2') || input.includes('motor2')) {
      if (input.includes('on') || input.includes('chalu') || input.includes('start')) {
        await this.executeFanAction('fan2', true, 'fan2On', 'Classroom Fan 2 is now running.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop')) {
        await this.executeFanAction('fan2', false, 'fan2Off', 'Classroom Fan 2 is now turned OFF.');
        return;
      }
    }

    if (input.includes('fan') || input.includes('fans') || input.includes('motor') || input.includes('pankha')) {
      if (input.includes('on') || input.includes('chalu') || input.includes('start') || input.includes('chalao')) {
        await this.executeFanAction('fan1', true, 'motorOn', 'Classroom fans are now turned ON.');
        await this.executeFanAction('fan2', true, 'motorOn', 'Classroom fans are now turned ON.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop')) {
        await this.executeFanAction('fan1', false, 'motorOff', 'Classroom fans are now turned OFF.');
        await this.executeFanAction('fan2', false, 'motorOff', 'Classroom fans are now turned OFF.');
        return;
      }
    }

    // 7. WATER PUMP CONTROLS
    if (input.includes('pump') || input.includes('water') || input.includes('pani')) {
      if (input.includes('on') || input.includes('chalu') || input.includes('start')) {
        await this.executeRawDeviceCommand('pump', 'ON', 'pumpOn', 'Water pump is now turned ON.');
        return;
      }
      if (input.includes('off') || input.includes('band') || input.includes('stop')) {
        await this.executeRawDeviceCommand('pump', 'OFF', 'pumpOff', 'Water pump is now turned OFF.');
        return;
      }
    }

    // 8. FIRE ALARM TEST
    if (input.includes('fire') || input.includes('alarm') || input.includes('aag')) {
      if (input.includes('on') || input.includes('test') || input.includes('start') || input.includes('chalu')) {
        if (typeof controlDevice === 'function') controlDevice('fire', 'test');
        this.speakResponse("Fire safety alert activated!", 'fireOn', true);
        return;
      }
      if (input.includes('off') || input.includes('stop') || input.includes('band') || input.includes('safe')) {
        if (typeof controlDevice === 'function') controlDevice('fire', 'stop');
        this.speakResponse("Fire alarm stopped. Systems are safe.", 'fireOff', true);
        return;
      }
    }

    // 9. COUNTER RESET
    if (input.includes('counter') || input.includes('count') || input.includes('ginti')) {
      if (input.includes('reset') || input.includes('zero') || input.includes('clear')) {
        if (typeof resetCounter === 'function') {
          await resetCounter();
          this.speakResponse("Object counter has been reset to zero.", 'success', true);
        } else {
          this.speakResponse("Counter reset requested.", 'success', true);
        }
        return;
      }
    }

    // 10. GLOBAL CONTROLS
    if (input.includes('all on') || input.includes('sab on') || input.includes('turn all on')) {
      if (typeof toggleAllDevices === 'function') await toggleAllDevices(true);
      this.speakResponse("All classroom devices are now turned ON.", 'success', true);
      return;
    }

    if (input.includes('emergency') || input.includes('all off') || input.includes('sab band') || input.includes('stop all')) {
      if (typeof emergencyStop === 'function') await emergencyStop();
      this.speakResponse("Emergency stop activated. All systems disabled.", 'buzzerOff', true);
      return;
    }

    // 11. MANUAL WORKFLOWS — backend is authoritative; localStorage is the offline cache.
    try {
      const skills = this.loadManualSkills();
      const normInput = this.normalizeQuestion(input);
      const skill = skills.find(x => {
        if (x.enabled === false) return false;
        const t = this.normalizeQuestion(x.trigger);
        return t && (normInput === t || normInput.includes(t));
      });
      if (skill) {
        this.setState('PROCESS');
        const base = this.config.apiBaseUrl || 'http://127.0.0.1:8000';
        const response = await fetch(`${base}/api/skills/${encodeURIComponent(skill.id)}/run`, {method:'POST'});
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.response || `Workflow execution failed (HTTP ${response.status})`);
        }
        if (data.serial_command && typeof sendArduinoCommand === 'function') {
          for (const command of data.serial_command.split('\n').filter(Boolean)) {
            const sent = await sendArduinoCommand(command);
            if (!sent) {
              this.displayBubbleText('Arduino connected nahi hai, isliye hardware action complete nahi hua.');
              return;
            }
          }
        }
        this.speakResponse(`${skill.name} complete.`, 'success', true);
        return;
      }
    } catch (e) {
      console.warn('[Assistant] Manual workflow error:', e);
      const matched = this.loadManualSkills().find(x => x.enabled !== false && this.normalizeQuestion(x.trigger) === this.normalizeQuestion(input));
      if (matched) {
        const msg = String(e?.message || '');
        if (/Failed to fetch|NetworkError|fetch/i.test(msg)) {
          this.displayBubbleText('Workflow saved hai, lekin backend se connection nahi ho raha. Backend ko port 8000 par start karke dobara try karein.');
        } else {
          this.displayBubbleText(`${matched.name} execute nahi hua: ${msg || 'action controller ne request reject kar di.'}`);
        }
        return;
      }
    }

    // 12. Basic local backend only
    try {
      const aiResult=await this.queryBackendAI(rawInput);
      if(aiResult?.response && aiResult.intent && aiResult.intent!=='UNKNOWN_COMMAND'){
        if(aiResult.is_arduino_command && aiResult.serial_command && typeof sendArduinoCommand==='function'){
          for(const cmd of aiResult.serial_command.split('\n')) if(cmd.trim()) await sendArduinoCommand(cmd.trim());
        }
        this.speakResponse(aiResult.response,null,!!(aiResult.is_arduino_command||aiResult.is_pc_command||aiResult.is_pc_command));
        return;
      }
    }catch(e){console.warn('[Assistant] basic backend unavailable',e);}

    this.speakResponse(`Ye kaam abhi mujhe sikhaya nahi gaya hai. AI Customize Mode mein iske liye workflow bana sakte ho.`,null,false);
  }

  async executeManualStep(step){
    const r=await this.queryBackendAI(step);
    if(!r || !r.success){ this.speakResponse(r?.response || `Ye action complete nahi hua: ${step}`,null,false); return false; }
    if(r.serial_command && typeof sendArduinoCommand==='function'){for(const cmd of r.serial_command.split('\n'))if(cmd.trim())await sendArduinoCommand(cmd.trim());}
    return true;
  }

  // Device Action Helpers (Reusing existing website functions)
  async executeDeviceAction(device, action, voiceKey, successMessage) {
    try {
      if (typeof controlDevice === 'function') {
        const success = await controlDevice(device, action);
        if (!success) throw new Error('Device command was not accepted');
        this.speakResponse(successMessage, voiceKey, true);
      } else if (typeof sendArduinoCommand === 'function') {
        const cmdMap = {
          'light:on': '1', 'light:off': '0',
          'gate:open': '2', 'gate:close': '3',
          'bell:ring': 'B', 'bell:stop': 'b'
        };
        const cmd = cmdMap[`${device}:${action}`];
        if (cmd) await sendArduinoCommand(cmd);
        this.speakResponse(successMessage, voiceKey, true);
      } else {
        throw new Error('Device control function not found');
      }
    } catch (e) {
      console.error('[Assistant] Device execution error:', e);
      this.speakResponse("Sorry, I could not complete that device command.", null, false);
    }
  }

  async executeFanAction(device, state, voiceKey, successMessage) {
    try {
      if (typeof toggleFanSwitch === 'function') {
        toggleFanSwitch(device, state);
        const switchEl = document.getElementById(device === 'fan1' ? 'fan1-switch' : 'fan2-switch');
        if (switchEl) switchEl.checked = state;
        this.speakResponse(successMessage, voiceKey, true);
      } else if (typeof sendArduinoCommand === 'function') {
        const cmd = device === 'fan1' ? (state ? 'F' : 'f') : (state ? 'G' : 'g');
        await sendArduinoCommand(cmd);
        this.speakResponse(successMessage, voiceKey, true);
      } else {
        throw new Error('Fan control function not found');
      }
    } catch (e) {
      console.error('[Assistant] Fan execution error:', e);
      this.speakResponse("Sorry, I could not change the fan state.", null, false);
    }
  }

  async executeRawDeviceCommand(device, value, voiceKey, successMessage) {
    try {
      if (typeof sendArduinoCommand === 'function') {
        const sent = await sendArduinoCommand(`${device}:${value}`);
        if (!sent) throw new Error('Arduino command was not sent');
        this.speakResponse(successMessage, voiceKey, true);
      } else {
        throw new Error('Arduino command function not found');
      }
    } catch (e) {
      console.error('[Assistant] Raw command execution error:', e);
      this.speakResponse("Sorry, I could not send the command.", null, false);
    }
  }

  handleStatusQuery() {
    const states = window.deviceStates || {};
    const active = [];

    if (states.light) active.push('Classroom Light');
    if (states.fan1) active.push('Fan 1');
    if (states.fan2) active.push('Fan 2');
    if (states.gate === 'open') active.push('Gate Open');
    if (states.bell === 'ringing') active.push('Buzzer Ringing');
    if (states.fire === 'alarm') active.push('Fire Alarm Active');

    let response = '';
    if (active.length > 0) {
      response = `Currently active devices are: ${active.join(', ')}. Visitor count is ${states.counter || 0}.`;
    } else {
      response = `All primary devices are currently OFF. Visitor counter is at ${states.counter || 0}.`;
    }

    this.speakResponse(response, null, false);
  }
}

// Attach to window
window.AnimeAssistant = AnimeAssistant;

