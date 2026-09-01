/**
 * Anime AI Assistant Configuration
 * Centralized configuration for animations, voice assets, speech recognition,
 * natural language command routing, and dynamic fallback.
 */

window.ASSISTANT_CONFIG = {
  // Animation video files mapped to state machine states (WebM optimized with MP4 fallback)
  animations: {
    hello: "assets/videos/optimized/Anime_girl_waving_greeting_202608221740.webm",
    idle: "assets/videos/optimized/Anime_girl_breathing_idle_animation_202608221740.webm",
    listen: "assets/videos/optimized/Anime_girl_listening_loop_202608221748.webm",
    process: "assets/videos/optimized/Anime_girl_thinking_and_tapping_202608221750.webm",
    speak: "assets/videos/optimized/Anime_assistant_speaking_loop_202608221834.webm",
    done: "assets/videos/optimized/Anime_girl_giving_thumbs-up_202608221740.webm",
    drag: "assets/videos/optimized/WhatsApp Video 2026-08-29 at 8.28.46 PM.mp4",
    drop: "assets/videos/optimized/Shan.mp4"
  },
  dragAnimationVideo: "assets/videos/optimized/WhatsApp Video 2026-08-29 at 8.28.46 PM.mp4",
  dropAnimationVideo: "assets/videos/optimized/Shan.mp4",
  dragPlaybackRate: 1.10,
  dropPlaybackRate: 1.10,


  animationsFallback: {
    hello: "ai anime girl/Anime_girl_waving_greeting_202608221740.mp4",
    idle: "ai anime girl/Anime_girl_breathing_idle_animation_202608221740.mp4",
    listen: "ai anime girl/Anime_girl_listening_loop_202608221748.mp4",
    process: "ai anime girl/Anime_girl_thinking_and_tapping_202608221750.mp4",
    speak: "ai anime girl/Anime_assistant_speaking_loop_202608221834.mp4",
    done: "ai anime girl/Anime_girl_giving_thumbs-up_202608221740.mp4",
    drag: "assets/videos/optimized/WhatsApp Video 2026-08-29 at 8.28.46 PM.mp4",
    drop: "assets/videos/optimized/Shan.mp4"
  },

  // AI Identity Configuration (Single Source of Truth)
  assistantName: "Ronit",
  aiIdentity: {
    name: "Ronit",
    role: "Smart School AI Assistant",
    school: "BAV INTER COLLEGE",
    creator: "Shan"
  },

  // State behavior settings
  states: {
    HELLO: { loop: false, autoNext: 'IDLE' },
    IDLE: { loop: true },
    LISTEN: { loop: true },
    PROCESS: { loop: true },
    SPEAK: { loop: true },
    DONE: { loop: false, autoNext: 'IDLE', durationMs: 2600 },
    DRAG: { loop: true },
    DROP: { loop: false, autoNext: 'IDLE' }
  },

  // Basic local controller backend (no external AI/API)
  apiBaseUrl: "http://127.0.0.1:8000",
  backendTimeout: 10000,


  // Voice configuration
  // No external voice API required. All dynamic replies use the browser's built-in SpeechSynthesis.
  voices: {},


};
