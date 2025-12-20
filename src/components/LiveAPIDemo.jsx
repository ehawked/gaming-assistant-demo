import React, { useImperativeHandle, forwardRef, useRef, useState, useEffect } from 'react';
import { GeminiLiveAPI } from '../utils/gemini-api';
import { AudioStreamer, ScreenCapture, AudioPlayer } from '../utils/media-utils';

/**
 * LiveAPIDemo - Main component for Gemini Live API integration
 * Manages WebSocket connection, audio streaming, and screen capture
 */
const LiveAPIDemo = forwardRef((props, ref) => {
  const {
    onConnectionChange,
    onAudioStreamChange,
    onScreenShareChange,
    onPreviewStreamChange,
  } = props;

  // Configuration with defaults
  const [config, setConfig] = useState({
    proxyUrl: 'ws://localhost:8080',
    projectId: '',
    model: 'gemini-2.0-flash-exp',
    systemInstructions: 'You are a helpful gaming assistant.',
    voice: 'Puck',
  });

  // Refs for API clients
  const geminiClientRef = useRef(null);
  const audioStreamerRef = useRef(null);
  const screenCaptureRef = useRef(null);
  const audioPlayerRef = useRef(null);

  // Local state
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioStreaming, setIsAudioStreaming] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Initialize Gemini client on mount
  useEffect(() => {
    console.log('🎮 Initializing Gemini Live API client...');

    const client = new GeminiLiveAPI(
      config.proxyUrl,
      config.projectId,
      config.model
    );

    // Set initial configuration
    client.setSystemInstructions(config.systemInstructions);
    client.setVoice(config.voice);
    client.setGoogleGrounding(true); // Enable Google Search grounding
    client.setInputAudioTranscription(true); // Enable transcription
    client.setOutputAudioTranscription(true);
    client.setProactivity({ proactiveAudio: true }); // Enable proactive audio

    // Initialize audio player
    const audioPlayer = new AudioPlayer();
    audioPlayerRef.current = audioPlayer;

    // Setup callbacks
    client.onReceiveResponse = (message) => {
      handleGeminiResponse(message, audioPlayer);
    };

    client.onConnectionStarted = () => {
      console.log('✅ Connection established');
      setIsConnected(true);
      onConnectionChange?.(true);
    };

    client.onClose = (event) => {
      console.log('🔌 Connection closed:', event);
      setIsConnected(false);
      onConnectionChange?.(false);

      // Clean up media streams on disconnect
      // Don't check state flags - they're stale in this closure
      // Just check if the refs exist and stop them
      if (audioStreamerRef.current) {
        console.log('🛑 Stopping audio stream due to disconnect');
        audioStreamerRef.current.stop();
        audioStreamerRef.current = null;
        setIsAudioStreaming(false);
        onAudioStreamChange?.(false);
      }

      if (screenCaptureRef.current) {
        console.log('🛑 Stopping screen capture due to disconnect');
        screenCaptureRef.current.stop();
        screenCaptureRef.current = null;
        setIsScreenSharing(false);
        onScreenShareChange?.(false);
        onPreviewStreamChange?.(null);
      }
    };

    client.onErrorMessage = (message) => {
      console.error('❌ Connection error:', message);
      alert(`Connection Error: ${message}`);
      setIsConnected(false);
      onConnectionChange?.(false);
    };

    geminiClientRef.current = client;

    console.log('✅ Gemini client initialized');

    // Cleanup on unmount
    return () => {
      if (geminiClientRef.current?.connected) {
        geminiClientRef.current.disconnect();
      }
      if (audioStreamerRef.current?.isStreaming) {
        audioStreamerRef.current.stop();
      }
      if (screenCaptureRef.current?.isStreaming) {
        screenCaptureRef.current.stop();
      }
      if (audioPlayerRef.current) {
        audioPlayerRef.current.destroy();
      }
    };
  }, []); // Empty deps - only initialize once

  // Handle responses from Gemini
  const handleGeminiResponse = (message, audioPlayer) => {
    switch (message.type) {
      case 'AUDIO':
        // Play audio response
        if (audioPlayer) {
          audioPlayer.play(message.data);
        }
        break;

      case 'TEXT':
        console.log('💬 Text response:', message.data);
        break;

      case 'SETUP_COMPLETE':
        console.log('🏁 Setup complete');
        break;

      case 'TURN_COMPLETE':
        console.log('✅ Turn complete');
        break;

      case 'INTERRUPTED':
        console.log('⚠️ Interrupted');
        if (audioPlayer) {
          audioPlayer.interrupt();
        }
        break;

      case 'INPUT_TRANSCRIPTION':
        console.log('🎤 User said:', message.data.text);
        break;

      case 'OUTPUT_TRANSCRIPTION':
        console.log('🔊 Assistant said:', message.data.text);
        break;

      case 'TOOL_CALL':
        console.log('🛠️ Tool call:', message.data);
        break;

      case 'ERROR':
        console.error('❌ Error:', message.data);
        break;

      default:
        console.log('📦 Unknown message type:', message.type);
    }
  };

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    connect: () => {
      if (!geminiClientRef.current) {
        console.error('Gemini client not initialized');
        return;
      }

      // Check the client's projectId directly (not stale config state)
      if (!geminiClientRef.current.projectId) {
        alert('Please enter your Google Cloud Project ID in the configuration dropdown');
        return;
      }

      console.log('🔌 Connecting to Gemini Live API...');
      geminiClientRef.current.connect();
    },

    disconnect: () => {
      if (!geminiClientRef.current) return;
      console.log('🔌 Disconnecting...');
      geminiClientRef.current.disconnect();
    },

    toggleAudio: async () => {
      if (!geminiClientRef.current?.connected) {
        alert('Please connect to the API first');
        return;
      }

      if (isAudioStreaming) {
        // Stop audio
        if (audioStreamerRef.current) {
          audioStreamerRef.current.stop();
          audioStreamerRef.current = null;
        }
        setIsAudioStreaming(false);
        onAudioStreamChange?.(false);
        console.log('🎤 Audio streaming stopped');
      } else {
        // Start audio
        try {
          const audioStreamer = new AudioStreamer(geminiClientRef.current);
          await audioStreamer.start();
          audioStreamerRef.current = audioStreamer;
          setIsAudioStreaming(true);
          onAudioStreamChange?.(true);
          console.log('🎤 Audio streaming started');
        } catch (error) {
          console.error('Failed to start audio:', error);
          if (error.name === 'NotAllowedError') {
            alert('Microphone permission denied. Please allow microphone access and try again.');
          } else {
            alert(`Failed to start microphone: ${error.message}`);
          }
          setIsAudioStreaming(false);
          onAudioStreamChange?.(false);
        }
      }
    },

    toggleScreen: async () => {
      if (!geminiClientRef.current?.connected) {
        alert('Please connect to the API first');
        return;
      }

      if (isScreenSharing) {
        // Stop screen share
        if (screenCaptureRef.current) {
          screenCaptureRef.current.stop();
          screenCaptureRef.current = null;
        }
        setIsScreenSharing(false);
        onScreenShareChange?.(false);
        onPreviewStreamChange?.(null);
        console.log('🖥️ Screen sharing stopped');
      } else {
        // Start screen share
        try {
          const screenCapture = new ScreenCapture(geminiClientRef.current);
          const videoElement = await screenCapture.start({
            fps: 1, // 1 frame per second
            quality: 0.7,
          });

          // Get the media stream for preview
          const mediaStream = screenCapture.mediaStream;

          screenCaptureRef.current = screenCapture;
          setIsScreenSharing(true);
          onScreenShareChange?.(true);
          onPreviewStreamChange?.(mediaStream);
          console.log('🖥️ Screen sharing started');

          // Handle user stopping screen share via browser UI
          if (mediaStream) {
            mediaStream.getVideoTracks()[0].onended = () => {
              console.log('User stopped screen sharing via browser');
              setIsScreenSharing(false);
              onScreenShareChange?.(false);
              onPreviewStreamChange?.(null);
              screenCaptureRef.current = null;
            };
          }
        } catch (error) {
          console.error('Failed to start screen share:', error);
          if (error.name === 'NotAllowedError') {
            alert('Screen share permission denied.');
          } else {
            alert(`Failed to start screen share: ${error.message}`);
          }
          setIsScreenSharing(false);
          onScreenShareChange?.(false);
        }
      }
    },

    setConfig: (newConfig) => {
      console.log('⚙️ Updating configuration:', newConfig);

      setConfig((prev) => ({ ...prev, ...newConfig }));

      if (!geminiClientRef.current) return;

      // Update Gemini client with new config
      if (newConfig.projectId) {
        geminiClientRef.current.setProjectId(newConfig.projectId);
      }
      if (newConfig.systemInstructions) {
        geminiClientRef.current.setSystemInstructions(newConfig.systemInstructions);
      }
      if (newConfig.voice) {
        geminiClientRef.current.setVoice(newConfig.voice);
      }
    },

    // Expose config for debugging
    getConfig: () => config,
    getClient: () => geminiClientRef.current,
  }));

  // This component doesn't render anything visible
  return null;
});

LiveAPIDemo.displayName = 'LiveAPIDemo';

export default LiveAPIDemo;
