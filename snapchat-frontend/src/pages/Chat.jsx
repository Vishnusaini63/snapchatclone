import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import ChatBox from "../components/ChatBox";
import "../styles/chat.css";
import socket from "../components/socket";
import axios from "axios";

const Chat = () => {
  const navigate = useNavigate();
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("user") || "{}"));
  const [callIncoming, setCallIncoming] = useState(null);
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const ringtone = React.useRef(new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3")).current;

  useEffect(() => {
    // Refresh user data when selecting friend to get latest privacy settings
    setUser(JSON.parse(localStorage.getItem("user") || "{}"));
  }, [selectedFriend]);

  useEffect(() => {
    if (!user?.id) return;
    const token = localStorage.getItem("token");

    // Call context ke liye data load karein
    axios.get("https://snapchatclone.onrender.com/api/auth/friends", {
      headers: { authorization: "Bearer " + token }
    }).then(res => setFriends(res.data));

    axios.get(`https://snapchatclone.onrender.com/api/group/my/${user.id}`)
      .then(res => setGroups(res.data));

    const handleIncomingCall = (data) => {
      if (callIncoming) return;
      setCallIncoming(data);
      ringtone.currentTime = 0;
      ringtone.loop = true;
      ringtone.play().catch(() => {});
    };

    const stopRingtone = (data) => {
      console.log("Stopping global ringtone...");
      
      // Group call mein agar koi join kare toh popup nahi hatna chahiye baaki logo ke liye
      if (data?.isGroup && !data?.ended) return;

      ringtone.pause(); 
      ringtone.loop = false;
      ringtone.currentTime = 0; 
      setCallIncoming(null);
    };

    socket.on("incomingCall", handleIncomingCall);
    socket.on("callEnded", () => stopRingtone({ ended: true }));
    socket.on("callAccepted", (data) => stopRingtone(data));
    socket.on("callRejected", (data) => stopRingtone(data));

    return () => {
      socket.off("incomingCall", handleIncomingCall);
      socket.off("callEnded", stopRingtone);
      socket.off("callAccepted", stopRingtone);
      socket.off("callRejected", stopRingtone);
    };
  }, [user?.id, callIncoming]);

  const handleAcceptCall = () => {
    ringtone.loop = false;
    ringtone.pause();
    ringtone.currentTime = 0;

    let target;
    if (callIncoming.isGroup) {
      target = groups.find(g => String(g.id) === String(callIncoming.groupId));
      if (target) target = { ...target, isGroup: true };
    } else {
      target = friends.find(f => String(f.id) === String(callIncoming.from));
    }

    if (target) {
      localStorage.setItem("ongoingCall", JSON.stringify({
        withUserId: target.id,
        type: callIncoming.callType,
        isInitiator: false,
        isGroup: !!callIncoming.isGroup
      }));

      // 🔥 Force refresh call state in ChatBox immediately
      window.dispatchEvent(new Event("resumeCall"));

      socket.emit("answerCall", { 
        to: callIncoming.from, 
        from: user.id,
        isGroup: !!callIncoming.isGroup,
        groupId: callIncoming.groupId
      });
      setSelectedFriend(target);
    }
    setCallIncoming(null);
  };

  const handleRejectCall = () => {
    ringtone.loop = false;
    ringtone.pause();
    ringtone.currentTime = 0;

    socket.emit("rejectCall", {
      to: callIncoming.from,
      from: user.id,
      callType: callIncoming.callType,
      isGroup: !!callIncoming.isGroup,
      groupId: callIncoming.groupId
    });
    setCallIncoming(null);
  };

  return (
    <div className="chat-page" style={{ position: 'relative', background: '#f0f0f0', height: '100vh', overflow: 'hidden' }}>
      {!selectedFriend ? (
        // 📱 Jab koi friend select nahi hai, sirf Sidebar (List) dikhao
        <Sidebar onSelectFriend={setSelectedFriend} />
      ) : (
        // 💬 Jab friend select ho jaye, sirf ChatBox dikhao
        <div className="chat-main">
          <ChatBox
            key={selectedFriend.id}
            friend={selectedFriend}
            user={user}
            onBack={() => setSelectedFriend(null)}
          />
        </div>
      )}

      {/* 📞 GLOBAL INCOMING CALL UI (Hamesha visible rahega) */}
      {callIncoming && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "#000", color: "#fff", zIndex: 100000,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{
             width: "120px", height: "120px", borderRadius: "50%", background: "#333",
             border: "3px solid #FFFC00", overflow: "hidden", marginBottom: "20px",
             display: "flex", alignItems: "center", justifyContent: "center"
          }}>
             {callIncoming.isGroup ? <div style={{fontSize: "40px"}}>👥</div> : 
              (() => {
                const f = friends.find(f => String(f.id) === String(callIncoming.from));
                return f ? <img src={f.avatar || f.profile_pic} style={{width:"100%", height:"100%", objectFit:"cover"}} alt="" /> : <div style={{fontSize: "40px"}}>👤</div>
              })()
             }
          </div>
          <h2>{callIncoming.isGroup ? (groups.find(g => String(g.id) === String(callIncoming.groupId))?.name || "Group Call") : (callIncoming.name || "Friend")}</h2>
          <p style={{ color: "#25D366", fontWeight: "bold", marginTop: "10px" }}>
            Incoming {callIncoming.callType} {callIncoming.isGroup ? "group " : ""}call...
          </p>
          <div style={{ display: "flex", gap: "30px", marginTop: "40px" }}>
            <button onClick={handleAcceptCall} style={{
              background: "#25D366", color: "white", width: "70px", height: "70px", 
              borderRadius: "50%", border: "none", fontSize: "24px", cursor: "pointer"
            }}>📞</button>
            <button onClick={handleRejectCall} style={{
              background: "red", color: "white", width: "70px", height: "70px", 
              borderRadius: "50%", border: "none", fontSize: "24px", cursor: "pointer"
            }}>❌</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;


{/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
      {/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
      {/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
      {/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
     