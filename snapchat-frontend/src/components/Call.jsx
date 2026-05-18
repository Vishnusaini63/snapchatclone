import React, { useRef, useEffect, useState } from "react";
import socket from "./socket";

const Call = ({ user, friend, callType: initialCallType, isCaller, startSignaling, targetUserId, onEnd })=> { 

      // 👇 YAHA ADD KAR
  const btnStyle = {
    padding: "12px",
    borderRadius: "50%",
    background: "#333",
    color: "#fff",
    border: "none",
    fontSize: "18px"
  };
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peerConnections = useRef({}); // 🔥 Multi-peer support
  const callStarted = useRef(false);

  const [remoteStreams, setRemoteStreams] = useState({}); // 🔥 Multi-stream support
  const [callType, setCallType] = useState(initialCallType);
  const [stream, setStream] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const [remoteOffer, setRemoteOffer] = useState(null); // 🔥 Queue offer until stream is ready
  const pendingIceCandidates = useRef([]); // 🔥 Queue candidates
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  
  const [makingOffer, setMakingOffer] = useState(false); // 🔥 NEW: Track if we are making an offer
  // 🔥 Speaker sync ref for callbacks
  const isSpeakerOnRef = useRef(true);
  useEffect(() => { isSpeakerOnRef.current = isSpeakerOn; }, [isSpeakerOn]);

const [isFrontCamera, setIsFrontCamera] = useState(true);
const [hasRemoteStream, setHasRemoteStream] = useState(false); // 🔥 Track connection
const [remoteCameraOff, setRemoteCameraOff] = useState(initialCallType === "voice"); // 🔥 Start based on call type
const [isMinimized, setIsMinimized] = useState(false);
const callStartTime = useRef(null);
  const [remoteCameraStatuses, setRemoteCameraStatuses] = useState({});
  // ⏱️ TIMER
  const [seconds, setSeconds] = useState(0);
const toggleSpeaker = () => {
    if (remoteVideo.current) {
      // Speaker logic: Jab isSpeakerOn true hai (awaaz aa rahi hai), button dabane par muted true hoga.
      remoteVideo.current.muted = isSpeakerOn; 
      setIsSpeakerOn(!isSpeakerOn);
    }
};
  // 🎤 MUTE
  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  // 📷 CAMERA
  const toggleCamera = async () => {
    if (stream) {
      const newStatus = !isCameraOff;
      if (stream.getVideoTracks().length === 0) { await switchToVideo(); return; }
      stream.getVideoTracks().forEach(track => { track.enabled = !newStatus; });
      setIsCameraOff(newStatus);

      socket.emit("toggle-camera", { 
        to: friend.id, 
        isOff: newStatus, 
        isGroup: !!friend.isGroup 
      });
    }
  };

const endCall = () => {
  console.log("ENDING CALL DURATION:", seconds);

  // 🔥 STOP MEDIA
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  // 🔥 CLOSE ALL PEERS
  Object.values(peerConnections.current).forEach(pc => {
    if (pc) pc.close();
  });
  peerConnections.current = {};

  // 🔥 REAL DURATION CALCULATION
  const duration = callStartTime.current
    ? Math.floor((Date.now() - callStartTime.current) / 1000)
    : seconds;

  // 🔥 SEND TO PARENT
    if (onEnd) onEnd({ duration, callType, isGroup: !!friend.isGroup });
};

  // ⏱️ FORMAT TIME
  const formatTime = () => {
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };
  const startMedia = async () => {
    try {
      let media;
      const constraints = callType === "video" 
        ? { video: { facingMode: "user" }, audio: true } 
        : { audio: true };

      try {
        media = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        if (callType === "video") {
          console.log("Camera failed, switching to audio only");
          media = await navigator.mediaDevices.getUserMedia({ audio: true });
          showToast("Camera busy, starting voice call 🎧");
        } else {
          throw e;
        }
      }
      setStream(media);
      if (localVideo.current) localVideo.current.srcObject = media;
    } catch (err) {
      console.error("Media error:", err);
      showToast("Mic/Camera permission required 😢");
    }
  };

  const createPeer = (targetId) => {
    // 🔥 Existing connection hai toh wahi return karein
    if (peerConnections.current[targetId] && peerConnections.current[targetId].signalingState !== "closed") {
      return peerConnections.current[targetId];
    }

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ],
    iceCandidatePoolSize: 5,
    bundlePolicy: "max-bundle"
  });

  // 🔥 FIRST: ontrack
  pc.ontrack = (event) => {
    console.log(`Remote ${event.track.kind} track received`);
    if (!callStartTime.current) callStartTime.current = Date.now();

    setRemoteStreams(prev => {
      const newStreams = { ...prev };
      const currentStream = newStreams[targetId] || new MediaStream();
      
      // Prevent adding the same track multiple times
      if (!currentStream.getTracks().find(t => t.id === event.track.id)) {
        currentStream.addTrack(event.track);
      }

      // 🔥 IMPORTANT: Create a NEW MediaStream instance so React detects the change
      newStreams[targetId] = new MediaStream(currentStream.getTracks());
      return newStreams;
    });
  };

  // ✅ Robust connection tracking using connectionState
  // ✅ Robust connection tracking using connectionState
  // ✅ Robust connection tracking using connectionState
  pc.onconnectionstatechange = () => {
    console.log("WebRTC Connection State:", pc.connectionState);
    if (pc.connectionState === "connected" || pc.connectionState === "completed") {
      setHasRemoteStream(true);
    } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      console.error(`WebRTC connection failed: ${pc.connectionState} ❌`);
      showToast(`Connection failed: ${pc.connectionState} ❌`);
    }
  };






  pc.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", pc.iceConnectionState);
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      setHasRemoteStream(true);
    } else if (pc.iceConnectionState === "failed") {
      console.error("ICE handshake failed ❌ Check STUN/Network or firewall.");
      showToast("ICE handshake failed ❌");
    }
  };

  // 🔥 THEN add tracks
  if (stream) {
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const finalTargetId = targetId || ((!isCaller && remoteOffer) ? remoteOffer.from : friend.id);

      socket.emit("ice-candidate", {
        to: finalTargetId,
        from: user.id,
        candidate: e.candidate,
        isGroup: !!friend.isGroup
      });
    }
  };

  peerConnections.current[targetId] = pc;
  return pc;
};
const switchCamera = async () => {
  if (!stream) return;

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: isFrontCamera ? "environment" : "user" },
    audio: true,
  });

  const videoTrack = newStream.getVideoTracks()[0];
  const audioTrack = newStream.getAudioTracks()[0]; // 🔥 Capture new audio to maintain sync

  // Update all peer connections
  Object.values(peerConnections.current).forEach(pc => {
    if (!pc || pc.signalingState === "closed") return;
    
    const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
    if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);

    const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
    if (audioSender && audioTrack) audioSender.replaceTrack(audioTrack);
  });

  // 🔥 Maintain Mute State & Audio Connection
  if (isMuted && audioTrack) audioTrack.enabled = false;

  setStream(newStream);
  setIsFrontCamera(!isFrontCamera);

  if (localVideo.current) {
    localVideo.current.srcObject = newStream;
  }
};
const switchToVideo = async () => {
  try {
    // Stop existing tracks to free up the hardware (prevents "Camera inaccessible")
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    let videoStream;
    try {
      // Get fresh stream with both video and audio
      videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "user" }, 
        audio: true 
      });
    } catch (gUMError) {
      showToast("Camera inaccessible 📹");
      return;
    }

    const videoTrack = videoStream.getVideoTracks()[0];
    const audioTrack = videoStream.getAudioTracks()[0];

    setStream(videoStream);
    if (localVideo.current) localVideo.current.srcObject = videoStream;

      // 2. All PeerConnections mein video track swap ya add karein
      const isGroup = !!friend.isGroup;
      for (const [tid, pc] of Object.entries(peerConnections.current)) {
        if (!pc || pc.signalingState === "closed") continue;

      const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, videoStream);
      }

      const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
      if (audioSender && audioTrack) await audioSender.replaceTrack(audioTrack);
    
      // Renegotiate with all peers to show video
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", {
        to: tid,
        from: user.id,
        offer, // 🔥 Offer contains the new video track
        isGroup
      });
      }

    setCallType("video");
    setIsCameraOff(false);
  } catch (err) {
   console.error("Switch video failed:", err);
  }
};
const callUser = async (targetId) => {
    if (!stream || !targetId) return;

  const pc = createPeer(targetId);

  setMakingOffer(true); // 🔥 We are making an offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 🔥 Offer contains the initial audio/video tracks
  // (if callType is video, it will have both)
  socket.emit("offer", {
    to: targetId,
    from: user.id,
    offer,
    isGroup: !!friend.isGroup
  });
  setMakingOffer(false); // Offer sent
};

const handleOffer = async (data) => {
  const { offer, from, isGroup, groupId } = data;
  let pc = createPeer(from);
  if (!pc || pc.signalingState === "closed") return; // 🔥 Don't proceed if PC is closed

  const polite = !makingOffer; // 🔥 If we are not making an offer, we are polite

  try {
    // 🔥 Better Glare/Collision handling: Jab dono side se offer aye
    if (offer.type === "offer" && pc.signalingState !== "stable") {
      if (!polite) { // Impolite peer (caller) incoming offer ko ignore karega
        console.warn("Ignoring incoming offer during glare scenario.");
        return;
      }
      // Polite peer (receiver) apna local offer rollback karega remote offer accept karne ke liye
      await pc.setLocalDescription({ type: "rollback" });
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    if (offer.type === "offer" && pc.signalingState === "have-remote-offer") {
      const answer = await pc.createAnswer();

      // 🔥 FIX InvalidStateError: Answer set karne se pehle state check karein
      if (pc.signalingState !== "have-remote-offer") {
        console.warn("Signaling state changed, aborting answer setup.");
        return;
      }

      await pc.setLocalDescription(answer);

      processQueuedCandidates(pc);

      socket.emit("answer", {
        to: from,
        from: user.id,
        answer,
        isGroup: !!isGroup
      });
    }

    // ✅ ALWAYS process candidates and resume audio after description is set
    processQueuedCandidates(pc);
  } catch (err) {
    console.error("Handle offer failed:", err);
  }
};

const processQueuedCandidates = (pc) => {
  if (!pc || !pc.remoteDescription || pc.signalingState === "closed") return;
  while (pendingIceCandidates.current.length > 0) {
    const candidate = pendingIceCandidates.current.shift();
    pc.addIceCandidate(candidate).catch(e => console.warn("Queued ICE error:", e));
  }
};

const handleAnswer = async ({ answer, from }) => {
  const pc = peerConnections.current[from];
  if (!pc) return;
  if (pc.signalingState === "stable" || pc.signalingState === "closed") return;

  try {
    // Wrap answer in RTCSessionDescription
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    
    processQueuedCandidates(pc);

  } catch (e) {
    console.log("Answer error:", e);
  }
};

const handleIce = async ({ candidate, from }) => {
  if (candidate) {
    const pc = peerConnections.current[from];

    // Signaling check update taaki candidate reject na ho
    if (pc && pc.remoteDescription && (pc.signalingState === "stable" || pc.signalingState === "have-local-offer" || pc.signalingState === "have-remote-offer")) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)); // 🔥 Ensure RTCIceCandidate instance
      } catch (e) {
        console.error("ICE error ignore:", e);
      }
    } else {
      // 🔥 Queue candidate if PC not ready OR remote desc is null
      pendingIceCandidates.current.push(candidate);
    }
  }
};

  // ✅ Fix: Ensure local video is attached whenever stream/ref changes
  useEffect(() => {
    if (localVideo.current && stream) {
      localVideo.current.srcObject = stream;
    }
  }, [stream, callType]);


// 🔥 NEW: Effect to update remoteVideo.current.srcObject when remoteStream changes
useEffect(() => {
  const streams = Object.values(remoteStreams);
  if (remoteVideo.current && streams.length > 0) {
    const videoStream = streams.find(s => s.getVideoTracks().length > 0) || streams[0];
    if (remoteVideo.current.srcObject !== videoStream) {
      remoteVideo.current.srcObject = videoStream;
    }
    
    const hasVideo = videoStream.getVideoTracks().length > 0;
    if (hasVideo) {
      setCallType("video");
      setRemoteCameraOff(false);
    }
    setHasRemoteStream(true);
  }
}, [remoteStreams]);

  // ✅ Fix: Only handle offer when we have our own stream ready
  useEffect(() => {
// 🔥 Only handle if offer exists and we are not in a closed state
    const pcForOffer = remoteOffer ? peerConnections.current[remoteOffer.from] : null;
    
    if (remoteOffer && (stream || (pcForOffer && pcForOffer.signalingState !== "closed"))) {
      console.log("Stream ready, processing queued offer...");
      const data = remoteOffer;
      setRemoteOffer(null);
            handleOffer(data);

    }
  }, [remoteOffer, stream]);

  // 🚀 INIT
  useEffect(() => {
    startMedia();

    socket.on("offer", (data) => setRemoteOffer(data)); // 🔥 Queue offer instead of handling immediately
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIce);
    socket.on("toggle-camera", ({ userId, isOff }) => {
      setRemoteCameraStatuses(prev => ({ ...prev, [String(userId)]: isOff }));
    }); 

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("toggle-camera");
    };
  }, []);

 useEffect(() => {
  if (stream && startSignaling) {
    if (friend.isGroup) {
      // In group calls, everyone already in the call initiates a connection to the new joiner
      if (!targetUserId || String(targetUserId) === String(user.id)) return;
      callUser(targetUserId);
    } else if (isCaller) {
      // 1-to-1 logic (Iska purana behaviour maintain rakha hai)
      if (callStarted.current) return;
      callUser(friend.id);
      callStarted.current = true;
    }
  }
}, [stream, isCaller, startSignaling, targetUserId, friend.isGroup, user.id]); 

useEffect(() => {
  if (hasRemoteStream && !callStartTime.current) {
    callStartTime.current = Date.now();
  }
}, [hasRemoteStream]);

useEffect(() => {
  let interval;

  if (hasRemoteStream && !isMinimized) { // 🔥 Sync timer when connected
    interval = setInterval(() => {
      setSeconds(prev => prev + 1);
    }, 1000);
  }

  return () => clearInterval(interval);
}, [hasRemoteStream, isMinimized]); 
const getParticipantInfo = (pid) => {
    if (String(pid) === String(user.id)) return { username: "You", avatar: user.profile_pic || user.avatar };
    const member = friend.membersList?.find(m => String(m.id) === String(pid));
    if (member) return { username: member.username, avatar: member.profile_pic || member.avatar };
    if (!friend.isGroup) return { username: friend.username, avatar: friend.avatar || friend.profile_pic };
    return { username: "User", avatar: null };
  };

  const allParticipants = [
    { id: user.id, stream: stream, isLocal: true, cameraOff: isCameraOff },
    ...Object.entries(remoteStreams).map(([pid, rStream]) => ({
      id: pid,
      stream: rStream,
      isLocal: false,
// Camera tabhi off dikhayega jab signal mile ya video track bilkul na ho
      cameraOff: remoteCameraStatuses[pid] === true || rStream.getVideoTracks().length === 0    }))
  ];
  return (
    <>
  {toast && (
    <div style={{
      position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
      backgroundColor: "#333", color: "#fff", padding: "12px 25px",
      borderRadius: "30px", zIndex: 100000, fontWeight: "bold",
      boxShadow: "0 4px 15px rgba(0,0,0,0.3)", textAlign: "center",
      minWidth: "250px", animation: "popIn 0.3s ease-out"
    }}>
      {toast}
    </div>
  )}
<div style={{
  width: "100%",
  maxWidth: "500px", // Keep call screen in mobile view too
  height: "100vh",
  position: "fixed",
  top: 0,
  left: "50%",
  transform: "translateX(-50%)", // Center fixed call screen
  background: "#000",
  display: isMinimized ? "none" : "block",
  zIndex: 9999,
  overflow: "hidden"
}}>
    

{/* 🔙 BACK TO CHAT */}
<div
onClick={() => {
  setIsMinimized(true); // 🔥 ADD THIS
  window.dispatchEvent(new Event("minimizeCall"));
}}
  style={{
    position: "absolute",
    top: "20px",
    left: "15px",
    fontSize: "26px",
    color: "#fff",
    cursor: "pointer",
    zIndex: 10
  }}
>
  ⬅
</div>
      {/* ⏱️ TIMER */}
      <div style={{
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        color: "#fff",
        fontSize: "18px",
        zIndex: 5
      }}>
        {formatTime()}
      </div>

      {/* 📺 PARTICIPANTS RESPONSIVE GRID */}
      <div style={{
        display: 'grid',
        // Dynamic columns based on people count
        gridTemplateColumns: allParticipants.length <= 2 ? '1fr' : 
                             allParticipants.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr',
        gridAutoRows: allParticipants.length <= 2 ? '1fr' : 'minmax(200px, 1fr)',
        gap: '12px', padding: '75px 15px', height: 'calc(100% - 100px)', width: '100%',
        overflowY: 'auto', boxSizing: 'border-box'
      }}>
        {allParticipants.map((p) => (
          <ParticipantTile 
            key={p.id} 
            participant={p} 
            info={getParticipantInfo(p.id)} 
            isSpeakerOn={isSpeakerOn} 
            total={allParticipants.length}
          />
        ))}
      </div>

      {/* 🎮 CONTROLS */}
     <div style={{
  position: "absolute",
  bottom: "30px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  gap: "15px",
  zIndex: 5
}}>

  {/* 🎤 MUTE */}
  <button onClick={toggleMute} style={btnStyle}>
    {isMuted ? "🔇" : "🎤"}
  </button>

  {/* 🔊 SPEAKER */}
  <button onClick={toggleSpeaker} style={btnStyle}>
    {isSpeakerOn ? "🔊" : "🔈"}
  </button>

  {/* 📷 CAMERA ON/OFF */}
  {callType === "video" && (
    <button onClick={toggleCamera} style={btnStyle}>
      {isCameraOff ? "📷❌" : "📷"}
    </button>
  )}

  {/* 🔄 SWITCH CAMERA */}
  {callType === "video" && !isCameraOff && ( // 🔥 Hide switch if camera is off
    <button onClick={switchCamera} style={btnStyle}>
      🔄
    </button>
  )}

  {/* 🔥 VOICE → VIDEO */}
  {callType === "voice" && (
    <button onClick={switchToVideo} style={btnStyle}>
      📹
    </button>
  )}

  {/* ❌ END */}
  <button onClick={endCall} style={{
    ...btnStyle,
    background: "red"
  }}>
    ❌
  </button>

</div>
    </div>
    </>
  );
};

const ParticipantTile = ({ participant, info, isSpeakerOn, total }) => {
  const vRef = useRef();
  useEffect(() => {
    if (vRef.current && participant.stream) vRef.current.srcObject = participant.stream;
  }, [participant.stream]);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', background: '#1a1a1a', 
      borderRadius: '15px', overflow: 'hidden', display: 'flex', 
      alignItems: 'center', justifyContent: 'center', border: '1px solid #333'
    }}>
      <video
        ref={vRef}
        autoPlay
        playsInline
        muted={participant.isLocal || !isSpeakerOn}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: participant.cameraOff ? 'none' : 'block' }}
      />
      {participant.cameraOff && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: total > 6 ? '55px' : '90px', height: total > 6 ? '55px' : '90px', 
            borderRadius: '50%', background: '#333', border: '2px solid #FFFC00',
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {info.avatar ? <img src={info.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{fontSize: '24px'}}>👤</span>}
          </div>
          <span style={{ color: '#fff', fontSize: total > 4 ? '12px' : '14px', fontWeight: '600' }}>{info.username}</span>
        </div>
      )}
      {!participant.cameraOff && (
        <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '5px', color: '#fff', fontSize: '11px' }}>
          {info.username}
        </div>
      )}
    </div>
  );
};

export default Call;



      {/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
     