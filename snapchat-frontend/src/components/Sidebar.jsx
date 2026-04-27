import React, { useEffect, useState } from "react";
import axios from "axios";
import socket from "./socket.js";
import { useNavigate } from "react-router-dom";
import FriendRequestsView from "./FriendRequestsView.jsx"; // 🔥 NEW: Import FriendRequestsView
import AddFriendsView from "./AddFriendsView.jsx";
// 🔥 Move getHint outside to use it in multiple places
const getHint = (data) => {
  const type = data.type || data.mediaType;
  const content = data.edited_text || data.text || data.message || data.audioUrl;
  if (type === 'image') return "📷 Photo";
  if (type === 'video') return "📹 Video";
  if (type === 'voice') return "🎤 Voice message";
  if (type === 'document') return "📄 Document";
  if (type === 'profile') {
    try {
         const raw = typeof content === 'string' ? JSON.parse(content) : content;
      return `👤 ${raw.username}`;
    } catch (e) { return "👤 Profile"; }
  }
  if (type?.includes('call')) return content || "📞 Call log";
  return content ? (content.length > 20 ? content.substring(0, 20) + "..." : content) : "New message";
};

const Sidebar = ({ onSelectFriend, selectedFriend }) => {
  const navigate = useNavigate();
  // 🔥 CURRENT USER ID & DATA
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const [user, setUser] = useState(currentUser); // 👈 Start with local data

  const [showAddFriendsView, setShowAddFriendsView] = useState(false);
  const [showFriendRequestsView, setShowFriendRequestsView] = useState(false); // 🔥 NEW state for requests

  const [searchQuery, setSearchQuery] = useState(""); // 🔥 NEW: Search query state
  const [isSearching, setIsSearching] = useState(false); // 🔥 NEW: Toggle search bar
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ongoingCall, setOngoingCall] = useState(null);
  const [requestBadge, setRequestBadge] = useState(0); // 🔥 New request badge count
  const [notification, setNotification] = useState(null); // 🔥 NEW: Red Toast State
  const ringtone = React.useRef(new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3")).current;
  const receiveSound = React.useRef(new Audio("https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3")).current;
  
  // 🔥 Last messages preview state
  const [lastMessages, setLastMessages] = useState(() => {
    const saved = localStorage.getItem("lastMessages");
    return saved ? JSON.parse(saved) : {};
  });

  //  Unread counts state
  const [unreadCounts, setUnreadCounts] = useState(() => {
    const saved = localStorage.getItem("unreadCounts");
    return saved ? JSON.parse(saved) : {};
  });


  const [muteSettings, setMuteSettings] = useState({});
  const muteSettingsRef = React.useRef({});

  const token = localStorage.getItem("token");
useEffect(() => {
  if (!currentUser?.id) return;

  axios.get(`http://localhost:5000/api/group/my/${currentUser.id}`)
    .then(res => {
      const fixedGroups = res.data.map(g => ({
        ...g,
        created_by: Number(g.created_by), // 🔥 FIX
      }));

      console.log("GROUPS FIXED:", fixedGroups); // debug

      setGroups(fixedGroups);
    })
    .catch(err => console.log(err));
}, []);
  useEffect(() => {
    axios.get("http://localhost:5000/api/auth/profile", {
      headers: { authorization: "Bearer " + token }
    })
    .then(res => {
      const u = res.data.user;
      setUser({ ...u, avatar: u.avatar || u.profile_pic, profile_pic: u.profile_pic || u.avatar });
    });

    // 🔥 Fetch unread counts from server on load
    if (currentUser?.id) {
      axios.get(`http://localhost:5000/api/messages/unread-counts/${currentUser.id}`)
        .then(res => {
          const counts = {};
          res.data.forEach(item => {
            counts[item.conversation_id] = item.count;
          });
          setUnreadCounts(counts);
          localStorage.setItem("unreadCounts", JSON.stringify(counts));
        });

      // 🔥 Fetch latest message text for each friend from DB
      axios.get(`http://localhost:5000/api/messages/last-messages/${currentUser.id}`)
        .then(res => {
          const msgs = {};
          res.data.forEach(m => {
            msgs[m.friend_id] = getHint(m);
          });
          setLastMessages(prev => ({ ...prev, ...msgs }));
          localStorage.setItem("lastMessages", JSON.stringify({ ...lastMessages, ...msgs }));
        });
// 🔥 Fetch Mute Settings for all friends
      axios.get(`http://localhost:5000/api/chat/mute-settings/all/${currentUser.id}`)
        .then(res => {
         if (res.data && Array.isArray(res.data)) {
            const settings = {};
            res.data.forEach(s => { settings[String(s.friend_id)] = { chat: !!s.is_chat_muted, call: !!s.is_call_muted }; });
            setMuteSettings(settings);
            muteSettingsRef.current = settings;
          }
        })
   .catch(err => console.log("Mute settings API not found. Using default sounds."));


      // 🔥 Fetch initial pending requests count
      axios.get("http://localhost:5000/api/auth/requests", {
        headers: { authorization: "Bearer " + token }
      })
      .then(res => {
        setRequestBadge(res.data.length);
      });

    }

    getFriends();
  }, [token]);

  // 🔥 Ensure socket is connected and user is registered as soon as Sidebar loads
  useEffect(() => {
    if (!currentUser?.id) return;

    if (!socket.connected) socket.connect();
    socket.emit("registerUser", String(currentUser.id));

    const onConnect = () => socket.emit("registerUser", String(currentUser.id));
    socket.on("connect", onConnect);

    return () => socket.off("connect", onConnect);
  }, [currentUser?.id]);

useEffect(() => {
  const call = JSON.parse(localStorage.getItem("ongoingCall"));
  setOngoingCall(call || null);
}, []);
useEffect(() => {
  const interval = setInterval(() => {
    const call = JSON.parse(localStorage.getItem("ongoingCall"));
    setOngoingCall(call || null);
  }, 1000);

  return () => clearInterval(interval);
}, []);
useEffect(() => {
  const openId = localStorage.getItem("openChatUser");

  if (openId && friends.length > 0) {
    const f = friends.find(u => String(u.id) === String(openId));
    
    if (f) {
      onSelectFriend(f); // 🔥 DIRECT CHAT OPEN
      localStorage.removeItem("openChatUser");
    }
  }
}, [friends]);
  // 🔔 Socket Listener for Notifications


  useEffect(() => {
    socket.on("groupRenamed", (data) => {
      setGroups(prev =>
        prev.map(g =>
          String(g.id) === String(data.groupId)
            ? { ...g, name: data.newName }
            : g
        )
      );
    });

  socket.on("groupPicUpdated", (data) => {
    setGroups(prev =>
      prev.map(g =>
        String(g.id) === String(data.groupId)
          ? { ...g, group_pic: data.group_pic }
          : g
      )
    );
  });

  return () => {
    socket.off("groupRenamed");
    socket.off("groupPicUpdated");
  };
}, []);



  useEffect(() => {
    if (!currentUser) return;

    const updateSidebarPreview = (data) => {
      // Detect the friend's ID (could be sender or receiver)
      const senderId = String(data.sender || data.senderId || data.from || "");
      const receiverId = String(data.receiver || data.receiverId || "");
      
      // 🔥 Aggregation logic: Group messages should stay under Group ID
      const friendId = data.isGroup ? receiverId : String(senderId === String(currentUser.id) ? receiverId : senderId);
      
      if (!friendId || friendId === "undefined") return;
      
      // Check if this message is from the friend currently open in chat
      const isChattingWithSender = selectedFriend && String(selectedFriend.id) === friendId;

      // 1. Update Last Message Hint (Always update side preview)
      const hint = getHint(data);
      setLastMessages(prev => {
        const newLastMsgs = { ...prev, [friendId]: hint };
        localStorage.setItem("lastMessages", JSON.stringify(newLastMsgs));
        return newLastMsgs;
      });

      // Update Badge only for incoming messages not currently being read
      if (!isChattingWithSender && senderId !== String(currentUser.id)) {
        // 🔔 Respect Mute Settings (Robust check)
        const friendKey = String(friendId);
        const settings = muteSettingsRef.current?.[friendKey];
        const isChatMuted = !!settings?.chat; // Handles true, 1, "1" etc.

        console.log(`[Sidebar] Message from ${friendKey}. Muted: ${isChatMuted}`, settings);

        if (!isChatMuted) {
          receiveSound.currentTime = 0;
          receiveSound.play().catch((err) => console.log("Sound play failed:", err));
        } else {
          console.log("🔇 Sound suppressed (Chat is muted)");
        }

        // 🔥 Show Red Notification Toast
        let sourceName = "Someone";
        if (data.isGroup) {
          const group = groups.find(g => String(g.id) === receiverId);
          sourceName = group ? group.name : "Group";
        } else {
          sourceName = friends.find(f => String(f.id) === friendId)?.username || "Someone";
        }
        setNotification({ text: `New message from ${sourceName}: ${hint}`, isGroup: !!data.isGroup });
        setTimeout(() => setNotification(null), 3000);

        // 1. Update Badge Count
        setUnreadCounts(prev => {
          const newCounts = { ...prev, [friendId]: (prev[friendId] || 0) + 1 };
          localStorage.setItem("unreadCounts", JSON.stringify(newCounts));
          return newCounts;
        });

        // 2. 💾 Save message to localStorage history (Background Save)
        // This ensures if user refreshes before opening chat, message is not lost.
        const chatKey = `chat_${currentUser.id}_${senderId}`;
        const history = JSON.parse(localStorage.getItem(chatKey) || "[]");
        
        // Avoid duplicates if ChatBox is somehow also running (unlikely if !isChattingWithSender)
        const exists = history.some(msg => msg.localId === data.localId);
        if (!exists) {
          history.push(data);
          localStorage.setItem(chatKey, JSON.stringify(history));
        }
      }
    };

    // 📞 Handle Incoming Call Hints
    const handleIncomingCall = (data) => {
    };

    const handleAvatarUpdate = (data) => {
      console.log("Avatar update received for user:", data.userId);
      setFriends(prev => {
        const newFriends = prev.map(f => 
          String(f.id) === String(data.userId) ? { ...f, avatar: data.avatar, profile_pic: data.avatar } : f
        );
        
        // Agar wahi friend open hai jiski photo change hui, toh ChatBox/Call screen bhi update hogi
        if (selectedFriend && String(selectedFriend.id) === String(data.userId)) {
          onSelectFriend({ ...selectedFriend, avatar: data.avatar, profile_pic: data.avatar });
        }
        return newFriends;
      });
    };

    const handleMessagesMarkedRead = ({ userId, friendId }) => {
      // Agar maine messages read kiye hain, toh mera badge clear karo
      if (String(userId) === String(currentUser.id)) {
        setUnreadCounts(prev => {
          const newCounts = { ...prev, [friendId]: 0 };
          localStorage.setItem("unreadCounts", JSON.stringify(newCounts));
          return newCounts;
        });
      }
    };

    const handleStopRingtone = () => {
      console.log("[Sidebar] Stopping ringtone...");
      ringtone.loop = false;
      ringtone.pause();
      ringtone.currentTime = 0;
    };


   const handleMuteUpdate = (data) => {
      // 🛡️ Filter settings by userId to prevent global override
      if (String(data.userId) !== String(currentUser?.id)) return;

      setMuteSettings(prev => {
        const newSettings = { ...prev, [String(data.friendId)]: { chat: data.isChatMuted, call: data.isCallMuted } };
        muteSettingsRef.current = newSettings;
        return newSettings;
      });
    };

    const handleNewRequest = () => {
      setRequestBadge(prev => prev + 1);
      receiveSound.play().catch(() => {});
    };
// 🔥 GROUP LISTENER ADD KAR
const handleGroupCreated = (group) => {
  console.log("NEW GROUP:", group);

  // 🔥 SAFE CHECK ADD KIYA
  if (
    Array.isArray(group.members) &&
    group.members.map(String).includes(String(currentUser.id))
  ) {
    socket.emit("joinRoom", String(group.id)); // 🔥 Join room immediately
    setGroups(prev => {
      if (prev.find(g => g.id === group.id)) return prev;
      return [...prev, group];
    });
  }
};
socket.on("groupCreated", handleGroupCreated);
    socket.on("newFriendRequest", handleNewRequest);
    socket.on("receiveMessage", updateSidebarPreview);
    socket.on("messageSent", updateSidebarPreview); // 🔥 Update preview when I send a message too!
    socket.on("incomingCall", handleIncomingCall);
    socket.on("avatarUpdated", handleAvatarUpdate);
    socket.on("messagesMarkedRead", handleMessagesMarkedRead);
    socket.on("muteSettingsUpdated", handleMuteUpdate);
    socket.on("callEnded", handleStopRingtone);
    socket.on("callAccepted", handleStopRingtone); // 🔥 Sync if call accepted elsewhere

    // 🔥 NEW: Group Deleted Listener
    socket.on("groupDeleted", ({ groupId }) => {
      setGroups(prev => prev.filter(g => String(g.id) !== String(groupId)));
      
      // Agar user ussi group mein tha, toh chat band kar do
      if (selectedFriend && selectedFriend.isGroup && String(selectedFriend.id) === String(groupId)) {
        setNotification({ text: "This group has been deleted by the admin. 🗑️" });
        onSelectFriend(null);
      }
    });

    // 🔥 NEW: Member Left Listener
    socket.on("memberLeft", ({ groupId, userId }) => {
      if (String(userId) === String(currentUser.id)) {
        setGroups(prev => prev.filter(g => String(g.id) !== String(groupId)));
        if (selectedFriend && selectedFriend.isGroup && String(selectedFriend.id) === String(groupId)) {
          onSelectFriend(null);
        }
      }
    });

    socket.on("groupMembersUpdatedGlobal", ({ groupId, newMembersList }) => {
      setGroups(prev => prev.map(g => 
        String(g.id) === String(groupId) 
          ? { ...g, membersList: newMembersList } 
          : g
      ));
    });

    socket.on("adminTransferredGlobal", ({ groupId, newAdminId }) => {
      setGroups(prev => prev.map(g => 
        String(g.id) === String(groupId) 
          ? { ...g, created_by: Number(newAdminId) } 
          : g
      ));
    });

    socket.on("callRejected", handleStopRingtone);


    return () => {
      socket.off("newFriendRequest", handleNewRequest);
      socket.off("receiveMessage", updateSidebarPreview);
      socket.off("messageSent", updateSidebarPreview);
      socket.off("incomingCall", handleIncomingCall);
      socket.off("avatarUpdated", handleAvatarUpdate);
      socket.off("messagesMarkedRead", handleMessagesMarkedRead);
      socket.off("muteSettingsUpdated", handleMuteUpdate);
      socket.off("callEnded", handleStopRingtone);
      socket.off("callAccepted", handleStopRingtone);
      socket.off("groupCreated", handleGroupCreated);
      socket.off("callRejected", handleStopRingtone);
      socket.off("groupDeleted");
      socket.off("memberLeft");
      
    };
  }, [selectedFriend, currentUser?.id]);



  const getFriends = () => {
    axios.get("http://localhost:5000/api/auth/friends", {
      headers: { authorization: "Bearer " + token }
    })
    .then(res => {
      // 🔥 Filter out blocked friends from sidebar list
      const activeFriends = res.data.filter(f => f.status !== 'blocked');
      setFriends(activeFriends.map(f => ({ ...f, avatar: f.avatar || f.profile_pic })));
    })
    .catch(err => console.log(err));
  };

  const getUsers = () => {
    setShowAddFriendsView(true);
  };

  const getRequests = () => {
    setShowFriendRequestsView(true); // 🔥 Open new requests view
    setRequestBadge(0); // Clear badge when viewing
  };
const openChat = (item) => {
  console.log("Chat with:", item);

  // 🔥 GROUP HANDLE
  if (item.isGroup) {
    socket.emit("markAllAsRead", { senderId: currentUser.id, receiverId: item.id, isGroup: true });
    
    // 🔥 Clear badge locally for group
    setUnreadCounts(prev => {
      const newCounts = { ...prev, [item.id]: 0 };
      localStorage.setItem("unreadCounts", JSON.stringify(newCounts));
      return newCounts;
    });

    onSelectFriend(item);
    return;
  }

  // 👇 normal friend
  setUnreadCounts(prev => {
    const newCounts = { ...prev, [item.id]: 0 };
    localStorage.setItem("unreadCounts", JSON.stringify(newCounts));
    return newCounts;
  });

  socket.emit("markAllAsRead", { senderId: item.id, receiverId: currentUser.id });

  onSelectFriend(item);
};

  return (
    <div style={styles.container}>

      {/* 🔥 NEW: RED NOTIFICATION TOAST */}
      {notification && (
        <div style={{
          position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
          backgroundColor: "#FF0000", color: "#fff", padding: "12px 25px",
          borderRadius: "30px", zIndex: 100000, fontWeight: "bold",
          boxShadow: "0 4px 15px rgba(0,0,0,0.3)", textAlign: "center",
          minWidth: "250px", animation: "popIn 0.3s ease-out"
        }}>
          {notification.text}
        </div>
      )}

      {/* TOP BAR */}
      <div style={styles.topBar}>
        <img 
  src={user?.avatar || user?.profile_pic} 
  style={{ ...styles.avatar, cursor: "pointer" }} 
  onClick={() => navigate("/settings")} 
/>
        <h2 style={styles.title}>Chat</h2>

        <div style={styles.rightIcons}>
          <div 
            style={{ 
              ...styles.icon, 
              backgroundColor: isSearching ? "#FFFC00" : "#eee" 
            }} 
            onClick={() => { setIsSearching(!isSearching); if(isSearching) setSearchQuery(""); }}
          >🔍</div>
          <div style={{ position: "relative" }}>
            <div style={styles.icon} onClick={getRequests}>🔔</div>
            {requestBadge > 0 && (
              <div style={{
                position: "absolute",
                top: "-5px",
                right: "-5px",
                background: "#FF0000",
                color: "white",
                borderRadius: "50%",
                width: "18px",
                height: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                fontWeight: "bold",
                border: "2px solid #fff"
              }}>
                {requestBadge}
              </div>
            )}
          </div>
          <div style={styles.add} onClick={getUsers}>👤+</div>
        </div>
      </div>

      {/* 🔥 NEW: Search Bar UI */}
      {isSearching && (
        <div style={styles.searchContainer}>
          <input 
            type="text" 
            placeholder="Search friends..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
            autoFocus
          />
        </div>
      )}

      {/* USER */}
 {user && (
  <div 
    style={{ ...styles.userCard, cursor: "pointer" }}
    onClick={() => navigate("/settings")} // ✅ YAHAN HONA CHAHIYE
  >

   
  </div>
)}

  {/* FRIENDS */}
<div style={styles.chatList}>
{/* 🔥 GROUPS SHOW KAR */}
{groups.map(g => (
  <div
    key={g.id}
    style={styles.chatItem}
    onClick={() => openChat(g)}
  >
    <div style={{ fontSize: "20px" }}><img 
  src={g.group_pic || "/default.png"} 
  style={styles.avatar}
/></div>

    <div>
      <strong>{g.name}</strong>
      <p style={styles.sub}>Group chat</p>
    </div>

    {/* 🔴 GROUP UNREAD BADGE */}
    {unreadCounts[g.id] > 0 && (
      <div style={{
        marginLeft: 'auto', 
        background: '#FF0000', 
        color: 'white', 
        borderRadius: '50%', 
        width: '24px', 
        height: '24px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        fontSize: '12px', 
        fontWeight: 'bold'
      }}>
        {unreadCounts[g.id]}
      </div>
    )}
  </div>
))}

  {friends
    .filter(f => String(f.id) !== String(currentUser?.id)) // ✅ ADD THIS
    .filter(f => f.status !== 'blocked') // 🔥 NEW: Hide blocked friends from sidebar
    .filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase())) // 🔥 NEW: Search logic
    .map(f => (
      <div
        key={f.id}
        style={styles.chatItem}
        onClick={() => openChat(f)}
      >
        <img src={f.avatar || f.profile_pic} style={styles.avatar} />

        <div>
          <strong>{f.username}</strong>
          <p style={{ 
            ...styles.sub, 
            color: unreadCounts[f.id] > 0 ? '#00B4F6' : '#888', 
            fontWeight: unreadCounts[f.id] > 0 ? 'bold' : 'normal' 
          }}>
            {lastMessages[f.id] || "Tap to chat 💬"}
          </p>
        </div>

        {/* 🔴 UNREAD BADGE */}
        {unreadCounts[f.id] > 0 && (
          <div style={{
            marginLeft: 'auto', 
            background: '#FF0000', 
            color: 'white', 
            borderRadius: '50%', 
            width: '24px', 
            height: '24px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            fontSize: '12px', 
            fontWeight: 'bold'
          }}>
            {unreadCounts[f.id]}
          </div>
        )}
      </div>
    ))}
</div>



{/* 🟢 CALL RETURN BANNER */}
{ongoingCall && ongoingCall.withUserId && (
  <div
  onClick={() => {
  const call = JSON.parse(localStorage.getItem("ongoingCall"));

  if (!call) return;

  const f = friends.find(u => String(u.id) === String(call.withUserId));

  if (f) {
    onSelectFriend(f);

    // 🔥 call resume trigger
    setTimeout(() => {
      window.dispatchEvent(new Event("resumeCall"));
    }, 200);
  }
}}
    style={{
      width: "100%",
      background: "#25D366",
      color: "#000",
      textAlign: "center",
      padding: "10px 0",
      fontWeight: "600",
      cursor: "pointer",
      marginTop: "10px"
    }}
  >
    Tap to return to call
  </div>
)}

      {/* 🔥 NEW: Friend Requests View */}
      {showFriendRequestsView && (
        <FriendRequestsView
          user={user}
          onClose={() => setShowFriendRequestsView(false)}
          onFriendAdded={getFriends} // Friends list refresh karne ke liye
        />
      )}

      {showAddFriendsView && (
        <AddFriendsView 
          user={user} 
          onClose={() => setShowAddFriendsView(false)} 
          onFriendAdded={getFriends}
        />
      )}
    </div>
    
  );
};

const styles = {
  container: { 
    padding: "12px",
    boxSizing: "border-box",
    maxWidth: "500px", // Fixed mobile width
    margin: "0 auto",   // Centering
    height: "100vh",
    borderLeft: "1px solid #f0f0f0",
    borderRight: "1px solid #f0f0f0",
    backgroundColor: "#fff",
    overflowY: "auto"
  },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  avatar: { width: "42px", height: "42px", borderRadius: "50%", border: "2px solid #fffc00" },
  title: { fontSize: "20px" },
  rightIcons: { display: "flex", gap: "10px" },
  icon: { background: "#eee", padding: "8px", borderRadius: "50%", cursor: "pointer" },
  add: { background: "#fffc00", padding: "8px", borderRadius: "50%", cursor: "pointer" },
  userCard: { display: "flex", gap: "10px", marginTop: "10px" },
  chatList: { marginTop: "10px" },
  chatItem: { display: "flex", alignItems: "center", gap: "10px", padding: "10px", cursor: "pointer" },
  sub: { fontSize: "12px", color: "#888" },
  box: { marginTop: "10px", background: "#fff", padding: "10px", borderRadius: "10px" },
  searchContainer: { 
    padding: '10px 0', 
    borderBottom: '1px solid #f0f0f0',
    backgroundColor: '#fff' 
  },
  searchInput: { 
    width: '100%', 
    padding: '10px 15px', 
    borderRadius: '20px', 
    border: '1px solid #ddd', 
    outline: 'none', 
    background: '#f0f2f5', 
    fontSize: '15px',
    boxSizing: 'border-box'
  },
};

export default Sidebar;



      {/* Reactions dfgchjbnkml;,kjvcxvbnm,./mnvcxzvbnm,.mnbvcxvbnm,.kjxzcvjklkjhgfdxzcvbjn*/}
     //dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg