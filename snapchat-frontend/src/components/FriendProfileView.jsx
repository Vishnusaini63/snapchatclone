
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import socket from "./socket.js";

// Add token retrieval at the top of the component
const FriendProfileView = ({ friend, user, onClose }) => {
  const [media, setMedia] = useState([]);
  const [links, setLinks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const [activeTab, setActiveTab] = useState('media'); // 'media', 'links', 'documents'
  const [previewMedia, setPreviewMedia] = useState(null); // 🔥 NEW: Media Preview State
  const [showMenu, setShowMenu] = useState(false); // 🔥 NEW: Kebab Menu State
  const [isChatMuted, setIsChatMuted] = useState(false);
  const [isCallMuted, setIsCallMuted] = useState(false);
const [selectUserMode, setSelectUserMode] = useState(false);
const [showNamePopup, setShowNamePopup] = useState(false);
const [newName, setNewName] = useState("");
const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState('never');
const [friendsList, setFriendsList] = useState([]);
const [showGroupPicker, setShowGroupPicker] = useState(false);
const [selectedUsers, setSelectedUsers] = useState([]);
const [showAddMemberPicker, setShowAddMemberPicker] = useState(false); // 🔥 NEW: Added missing state
const [showRemoveMemberPicker, setShowRemoveMemberPicker] = useState(false); // 🔥 NEW
const [showAdminTransferPicker, setShowAdminTransferPicker] = useState(false); // 🔥 NEW
  const token = localStorage.getItem("token"); // Retrieve token here
 const [groupPic, setGroupPic] = useState(friend.group_pic || null);

// 🔥 Robust Admin Check: Creator or is_admin flag
const [membersArr, setMembersArr] = useState(Array.isArray(friend.membersList) ? friend.membersList : []);

useEffect(() => {
  const handleUpdate = ({ groupId, newMembersList }) => {
    if (String(groupId) === String(friend.id)) {
      setMembersArr(newMembersList);
    }
  };
  socket.on("groupMembersUpdatedGlobal", handleUpdate);
  return () => socket.off("groupMembersUpdatedGlobal", handleUpdate);
}, [friend.id]);

const isAdmin = friend.isGroup && (
  String(user.id) === String(friend.created_by) || 
  !!membersArr.find(m => String(m.id) === String(user.id))?.is_admin
);

const fileRef = useRef(null);
  useEffect(() => {
  setGroupPic(friend.group_pic || null);
  console.log("GROUP DATA:", friend);
}, [friend.group_pic]);
useEffect(() => {
  const fetchDeleteMode = async () => {
    try {
      const res = await axios.get(
        `https://snapchatclone.onrender.com/api/chat/delete-mode/${user.id}/${friend.id}`,
        { params: { isGroup: !!friend.isGroup } }
      );

      console.log("DELETE MODE API:", res.data); // 🔥 debug

   setDeleteAfter(res.data.deleteMode || "never");
    } catch (err) {
      console.error("Error fetching delete mode:", err);
    }
  };

  fetchDeleteMode();
}, [user.id, friend.id]);


useEffect(() => {
  const fetchMuteSettings = async () => {
    try {
      const res = await axios.get(
        `https://snapchatclone.onrender.com/api/chat/mute-settings/${user.id}/${friend.id}`
      );
      if (res.data) {
        setIsChatMuted(!!res.data.isChatMuted);
        setIsCallMuted(!!res.data.isCallMuted);
      }
    } catch (err) {
      console.error("Error fetching mute settings:", err);
    }
  };
  fetchMuteSettings();
}, [user.id, friend.id]);

  // 🔥 NEW: Listen for real-time updates to keep toggle in sync
  useEffect(() => {
    socket.on("deleteModeUpdated", (data) => {
      setDeleteAfter(data.deleteMode);
    });
    return () => socket.off("deleteModeUpdated");
  }, []);

useEffect(() => {
  const fetchChatContent = async () => {
    try {
      let res;

      if (friend.isGroup) {
        res = await axios.get(
          `https://snapchatclone.onrender.com/api/group/messages/${friend.id}`
        );
      } else {
        res = await axios.get(
          `https://snapchatclone.onrender.com/api/messages/history/${user.id}/${friend.id}`
        );
      }

      const allMessages = res.data;

      const mediaFiles = [];
      const extractedLinks = [];
      const documentFiles = [];

      allMessages.forEach(msg => {
        const messageContent = msg.edited_text || msg.message;

        if (msg.type === 'image' || msg.type === 'video') {
          mediaFiles.push({
            id: msg.id,
            url: messageContent,
            type: msg.type,
            timestamp: msg.created_at
          });
        } else if (msg.type === 'document') {
          documentFiles.push({
            id: msg.id,
            url: messageContent,
            name: messageContent.split('/').pop(),
            timestamp: msg.created_at
          });
        } else if (msg.type === 'text') {

          const urlRegex = /(https?:\/\/[^\s]+)/g;
          let match;

          while ((match = urlRegex.exec(messageContent)) !== null) {
            extractedLinks.push({
              id: msg.id,
              url: match[0],
              text: messageContent,
              timestamp: msg.created_at
            });
          }

          const docUrlRegex = /\/uploads\/[^\s]+\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar)$/i;
          if (docUrlRegex.test(messageContent)) {
            documentFiles.push({
              id: msg.id,
              url: messageContent,
              name: messageContent.split('/').pop(),
              timestamp: msg.created_at
            });
          }
        }
      });

      setMedia(mediaFiles);
      setLinks(extractedLinks);
      setDocuments(documentFiles);

    } catch (error) {
      console.error("Error fetching chat content:", error);
    }
  };

  fetchChatContent();
}, [friend.id, user.id]);
useEffect(() => {
  socket.on("groupPicUpdated", (data) => {
    if (String(data.groupId) === String(friend.id)) {
      setGroupPic(data.group_pic);
    }
  });

  return () => socket.off("groupPicUpdated");
}, [friend.id]);
useEffect(() => {
// ✅ FIXED DELETE EVENT
socket.on("messageDeleted", ({ messageId }) => {
  setMedia(prev => prev.filter(m => m.id !== messageId));
  setLinks(prev => prev.filter(l => l.id !== messageId));
  setDocuments(prev => prev.filter(d => d.id !== messageId));
});

  return () => socket.off("messageDeleted");
}, []);

const handleRemoveFriend = async () => {
  try {
    await axios.delete("https://snapchatclone.onrender.com/api/friends/remove", {
      data: {
        userId: user.id,
        friendId: friend.id
      }
    });

    showToast("Friend removed ✅");

    // UI se remove karna
    onClose(); // profile band kar
    // optionally: refresh friend list
  } catch (error) {
    console.error(error);
    showToast("Failed to remove friend ❌");
  }
};

const handleEditName = async (nickname) => {
  try {
    await axios.post("https://snapchatclone.onrender.com/api/friends/nickname", {
      userId: user.id,
      friendId: friend.id,
      nickname
    });

    showToast("Name updated ✅");
  } catch (err) {
    console.error(err);
  }
};

const handleEditGroupName = async (name) => {
  try {
    await axios.put("https://snapchatclone.onrender.com/api/group/rename", {
      groupId: friend.id,
      newName: name,
      adminId: user.id
    }, {
      headers: { authorization: "Bearer " + token }
    });

    showToast("Group name updated ✅");
    setShowNamePopup(false);
    // Optionally update local state if needed, 
    // though socket listener in Sidebar will handle the list update
    friend.name = name; 
  } catch (err) {
    console.error(err);
    showToast(err.response?.data?.error || "Error renaming group");
  }
};
const handleBlock = async () => {
  if (!window.confirm("Block this user?")) return;

  try {
    await axios.post("https://snapchatclone.onrender.com/api/friends/block", {
      userId: user.id,
      friendId: friend.id
    });

    showToast("User blocked 🚫");
    onClose();
  } catch (err) {
    console.error(err);
  }
};



  const openForwardPicker = async () => {
    try {
      const res = await axios.get("https://snapchatclone.onrender.com/api/auth/friends", { // Use token for authorization
        headers: { authorization: "Bearer " + token }
      });
      setFriendsList(res.data);
      setShowForwardPicker(true);
      setShowMenu(false); // Menu close kar do list dikhate waqt
    } catch (err) {
      console.error("Forward picker error", err);
    }
  };

const openGroupPicker = async () => {
  try {
    const res = await axios.get("https://snapchatclone.onrender.com/api/auth/friends", { // Use token for authorization
      headers: { authorization: "Bearer " + token }
    });

    setFriendsList(res.data);
    setShowGroupPicker(true);
    setShowMenu(false);
  } catch (err) {
    console.error(err);
  }
};

const openAddMemberPicker = async () => {
  try {
    const res = await axios.get("https://snapchatclone.onrender.com/api/auth/friends", {
      headers: { authorization: "Bearer " + token }
    });
    
    // Wo dost filter karo jo pehle se group mein nahi hain
    const currentMemberIds = (friend.members || friend.membersList || []).map(m => String(m.id));
    const friendsToAdd = res.data.filter(f => !currentMemberIds.includes(String(f.id)));
    
    setFriendsList(friendsToAdd);
    setShowAddMemberPicker(true);
    setShowMenu(false);
  } catch (err) {
    console.error(err);
  }
};

const toggleUserSelect = (f) => {
  setSelectedUsers(prev => {
    if (prev.find(u => u.id === f.id)) {
      return prev.filter(u => u.id !== f.id);
    } else {
      return [...prev, f];
    }
  });
};


  const sendProfileToFriend = (toFriend) => {
    const profileObj = {
      username: friend.username,
      avatar: friend.avatar || friend.profile_pic
    };
    const profileData = JSON.stringify(profileObj);
    const localId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    socket.emit("sendMessage", {
      localId: localId,
      sender: user.id,
      receiver: toFriend.id,
      text: profileData,
      type: 'profile'
    });

    setShowForwardPicker(false);
    showToast(`Profile sent to ${toFriend.username}! 🚀`);
  };
const handleToggleMute = async (type) => {
  let newChatMuted = isChatMuted;
  let newCallMuted = isCallMuted;

  if (type === "chat") {
    newChatMuted = !isChatMuted;
    setIsChatMuted(newChatMuted);
  }

  if (type === "call") {
    newCallMuted = !isCallMuted;
    setIsCallMuted(newCallMuted);
  }

  console.log("SENDING:", newChatMuted, newCallMuted); // 🔥 DEBUG

  try {
    await axios.post("https://snapchatclone.onrender.com/api/chat/mute-settings", {
      userId: user.id,
      friendId: friend.id,
      isChatMuted: newChatMuted,
      isCallMuted: newCallMuted
    });
  } catch (err) {
    console.error(err);
  }
};
 
const handleSaveDeleteMode = async () => {
  try {
    await axios.post("https://snapchatclone.onrender.com/api/chat/delete-mode", {
      userId: user.id,
      friendId: friend.id,
      deleteMode: deleteAfter, 
      type: 'everyone',
      isGroup: !!friend.isGroup
    }, { // Add authorization header
      headers: { authorization: "Bearer " + token }
    });

    showToast("Delete mode updated ✅");
    setShowDeleteOptions(false);
  } catch (err) {
    console.error(err);
    showToast("Error saving mode ❌");
  }
};

const handleCreateGroup = async () => {
  try {
    if (!newName.trim()) {
      showToast("Enter group name ✏️");
      return;
    }

    const res = await axios.post("https://snapchatclone.onrender.com/api/group/create", {
      name: newName,
      members: selectedUsers.map(u => u.id),
      creator: user.id   // 🔥 FIX
    }, {
      headers: { authorization: "Bearer " + token }
    });

    console.log("GROUP CREATED:", res.data);

    showToast("Group Created 🚀");

    setShowNamePopup(false);
    setShowGroupPicker(false);
    setSelectedUsers([]);
    setNewName("");

  } catch (err) {
    console.error("GROUP ERROR:", err.response?.data || err.message);
  }
};

const handleDeleteGroup = async () => {
  if (!window.confirm("Are you sure you want to delete this group? This will remove it for everyone! ⚠️")) return;

  try {
    await axios.delete("https://snapchatclone.onrender.com/api/group/delete", {
      data: {
        groupId: friend.id,
        adminId: user.id
      },
      headers: { authorization: "Bearer " + token }
    });

    showToast("Group deleted successfully ✅");
    onClose(); // Close profile view
  } catch (err) {
    console.error(err);
    showToast(err.response?.data?.error || "Error deleting group");
  }
};

const handleLeaveGroup = async () => {
  if (isAdmin) {
    const members = (friend.members || friend.membersList || []);
    const others = members.filter(m => String(m.id) !== String(user.id));

    if (others.length === 0) {
      if (window.confirm("You are the last member. Leaving will delete the group. Proceed?")) {
        await handleDeleteGroup();
      }
      return;
    }

    // Admin must transfer ownership
    setShowAdminTransferPicker(true);
    return;
  }

  if (!window.confirm("Are you sure you want to leave this group? 🚪")) return;

  try {
    await axios.delete("https://snapchatclone.onrender.com/api/group/leave", {
      data: {
        groupId: friend.id,
        userId: user.id
      },
      headers: { authorization: "Bearer " + token }
    });

    showToast("You left the group ✅");
    onClose(); // Close the profile view
  } catch (err) {
    console.error(err);
    showToast(err.response?.data?.error || "Error leaving group");
  }
};

const handleTransferAndLeave = async (newAdminId) => {
  if (!window.confirm("Make this member admin and leave?")) return;
  try {
    await axios.post("https://snapchatclone.onrender.com/api/group/transfer-and-leave", {
      groupId: friend.id,
      userId: user.id,
      newAdminId
    }, {
      headers: { authorization: "Bearer " + token }
    });
    showToast("Ownership transferred! You left the group 🚀");
    onClose();
  } catch (err) {
    console.error(err);
  }
};

const handleAddMembers = async () => {
  try {
    await axios.post("https://snapchatclone.onrender.com/api/group/member/add", {
      groupId: friend.id,
      userIds: selectedUsers.map(u => u.id)
    }, {
      headers: { authorization: "Bearer " + token }
    });

    showToast("Members added 🚀");
    setShowAddMemberPicker(false);
    setSelectedUsers([]);
    onClose(); // Refresh ke liye band kar do
  } catch (err) {
    console.error(err);
  }
};

const handlePromoteMember = async (memberId) => {
  try {
    await axios.post("https://snapchatclone.onrender.com/api/group/member/promote", {
      groupId: friend.id,
      memberId
    }, {
      headers: { authorization: "Bearer " + token }
    });
    showToast("Member promoted to Admin ✅");
    onClose(); 
  } catch (err) {
    console.error(err);
  }
};

const handleDemoteMember = async (memberId) => {
  try {
    await axios.post("https://snapchatclone.onrender.com/api/group/member/demote", {
      groupId: friend.id,
      memberId
    }, {
      headers: { authorization: "Bearer " + token }
    });
    showToast("Admin rights removed ✅");
    onClose();
  } catch (err) {
    console.error(err);
  }
};

const handleRemoveMember = async (memberId) => {
  if (!window.confirm("Remove this member from group?")) return;
  try {
    await axios.delete("https://snapchatclone.onrender.com/api/group/member/remove", {
      data: {
        groupId: friend.id,
        memberId: memberId,
        adminId: user.id
      },
      headers: { authorization: "Bearer " + token }
    });

    showToast("Member removed ✅");
    setShowRemoveMemberPicker(false);
    onClose(); // Refresh data by closing and reopening
  } catch (err) {
    console.error(err);
    showToast(err.response?.data?.error || "Error removing member");
  }
};

const handleGroupPicUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("image", file);
  formData.append("groupId", friend.id);

  try {
    const res = await axios.post(
      "https://snapchatclone.onrender.com/api/group/upload-pic",
      formData
    );

    setGroupPic(res.data.group_pic);

  } catch (err) {
    console.error(err);
  }
};
  return (
    <div style={styles.overlay}>
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

      <div style={styles.container}>
        <div style={styles.header}>
          <button onClick={onClose} style={styles.closeButton}>←</button>
        <h2 style={styles.title}>
  {friend.isGroup ? friend.name : friend.username}
</h2>
          
          {/* 🔥 NEW: 3-DOT KEBAB MENU */}
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button onClick={() => setShowMenu(!showMenu)} style={styles.menuButton}>⋮</button>
            {showMenu && (
              <React.Fragment>
                <div style={styles.menuOverlay} onClick={() => setShowMenu(false)} />
                <div style={styles.popupMenu}>
                  
                  {/* Mute Options */}
                        <div style={styles.menuItem} onClick={() => handleToggleMute('chat')}>
                    <span>Mute Chat</span>
                    <div style={{ ...styles.toggleTrack, ...(isChatMuted && styles.toggleTrackActive) }}>
                      <div style={{ ...styles.toggleThumb, ...(isChatMuted && styles.toggleThumbActive) }} />
                    </div>
                  </div>
                  
                 <div style={styles.menuItem} onClick={() => handleToggleMute('call')}>
                    <span>Mute Call</span>
                    <div style={{ ...styles.toggleTrack, ...(isCallMuted && styles.toggleTrackActive) }}>
                      <div style={{ ...styles.toggleThumb, ...(isCallMuted && styles.toggleThumbActive) }} />
                    </div>
                  </div>

                  <div style={styles.menuSeparator} />

                  {/* Dynamic Remove Option */}

                  {!friend.isGroup && (
                    <div style={styles.menuItem} onClick={handleBlock}>
                      🚫 Block Friend
                    </div>
                  )}

{/* 🔥 REMOVE MEMBER / FRIEND */}
{(!friend.isGroup || isAdmin) && (
  <div 
    style={styles.menuItem} 
    onClick={() => {
      if (friend.isGroup) {
        setShowRemoveMemberPicker(true);
      } else {
        handleRemoveFriend();
      }
      setShowMenu(false);
    }}
  >
    👤 {friend.isGroup ? (isAdmin ? "Manage Members" : "View Members") : "Remove Friend"}
  </div>
)}

                  {friend.isGroup && (
                    <div 
                      style={{ ...styles.menuItem, color: 'red' }} 
                      onClick={handleLeaveGroup}
                    >
                      🚪 Leave Group
                    </div>
                  )}

                  {isAdmin && (
                    <div 
                      style={{ ...styles.menuItem, color: 'red' }} 
                      onClick={handleDeleteGroup}
                    >
                      🗑️ Delete Group
                    </div>
                  )}

                  {/* 🔥 EDIT NAME (Visible to everyone in group, or 1-to-1) */}
                  <div 
                    style={styles.menuItem} 
                    onClick={() => {
                      setNewName(friend.isGroup ? (friend.name || "") : "");
                      setShowNamePopup(true);
                      setShowMenu(false);
                    }}
                  >
                    ✏️ {friend.isGroup ? "Edit Group Name" : "Edit Display Name"}
                  </div>
                  
                  {friend.isGroup && (
                    <div style={styles.menuItem} onClick={openAddMemberPicker}>
                      ➕ Add Member
                    </div>
                  )}
                  
                  <div style={styles.menuSeparator} />
                  
                  <div 
                    style={{ ...styles.menuItem, color: 'red' }} 
                    onClick={() => { setShowDeleteOptions(true); setShowMenu(false); }}
                  >
                    🗑️ Delete Messages
                  </div>

                  {!friend.isGroup && (
                    <>
                      <div style={styles.menuItem} onClick={openForwardPicker}>
                        📤 Send Profile
                      </div>

                      <div style={styles.menuItem} onClick={openGroupPicker}>
                        👨‍👩‍👧‍👦 Create Group
                      </div>
                    </>
                  )}
                </div>
              </React.Fragment>
             )}
          </div>
        </div>
{showNamePopup && (
  <div style={popupStyles.overlay}>
    <div style={popupStyles.box}>
      
      <h3>{selectedUsers.length >= 1 ? "Group Name" : (friend.isGroup ? "Rename Group" : "Edit Nickname")}</h3>

      <input
        type="text"
        placeholder="Enter new name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        style={popupStyles.input}
      />

      <div style={popupStyles.actions}>
        <button onClick={() => setShowNamePopup(false)}>Cancel</button>
  <button onClick={async () => {
  if (!newName) return;

  if (selectedUsers.length >=1) {
    await handleCreateGroup();   // 🔥 GROUP CREATE
  } else if (friend.isGroup) {
    await handleEditGroupName(newName); // 🔥 GROUP RENAME
  } else {
    await handleEditName(newName); // normal rename
  }

  setNewName("");
  setShowNamePopup(false);
}}>
  {selectedUsers.length >= 1 ? "Create" : "Save"}
</button>
      </div>

    </div>
  </div>
)}

{showDeleteOptions && (
  <div style={popupStyles.overlay}>
    <div style={{ ...popupStyles.box, width: '280px' }}>
      <h3 style={{ marginBottom: '15px', textAlign: 'center' }}>Delete Messages</h3>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px', textAlign: 'center' }}>
        Choose when messages should be deleted for both users.
      </p>
      
    <div 
  style={styles.menuItem}
  onClick={() => setDeleteAfter('after_view')}
>
  <span>After Viewing</span>
  <div style={{ ...styles.toggleTrack, ...(deleteAfter === 'after_view' && styles.toggleTrackActive) }}>
    <div style={{ ...styles.toggleThumb, ...(deleteAfter === 'after_view' && styles.toggleThumbActive) }} />
  </div>
</div>

<div 
  style={styles.menuItem}
  onClick={() => setDeleteAfter('24_hours')}
>
  <span>24 Hours after viewing</span>
  <div style={{ ...styles.toggleTrack, ...(deleteAfter === '24_hours' && styles.toggleTrackActive) }}>
    <div style={{ ...styles.toggleThumb, ...(deleteAfter === '24_hours' && styles.toggleThumbActive) }} />
  </div>
</div>

<div 
  style={styles.menuItem}
  onClick={() => setDeleteAfter('never')}
>
  <span>Never (Stay forever)</span>
  <div style={{ ...styles.toggleTrack, ...(deleteAfter === 'never' && styles.toggleTrackActive) }}>
    <div style={{ ...styles.toggleThumb, ...(deleteAfter === 'never' && styles.toggleThumbActive) }} />
  </div>
</div>

     <div style={{ ...popupStyles.actions, justifyContent: 'space-between', marginTop: '15px' }}>
  <button onClick={() => setShowDeleteOptions(false)}>Cancel</button>

  <button onClick={handleSaveDeleteMode}>
    Save
  </button>
</div>
    </div>
  </div>
)}
  <div style={styles.profileInfo}>

  {/* 🔵 PROFILE IMAGE BOX */}
  <div style={{
    position: "relative",
    width: "90px",
    height: "90px",
    marginBottom: "10px"
  }}>

    <img 
      src={
        friend.isGroup
          ? (groupPic || friend.group_pic || "/default.png")
          : (friend.avatar || friend.profile_pic)
      }
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        objectFit: "cover",
        border: "3px solid #FFFC00"
      }}
    />

    {friend.isGroup && (
      <div
        onClick={() => fileRef.current.click()}
        style={{
          position: "absolute",
          bottom: "0",
          right: "0",
          background: "#000",
          color: "#fff",
          borderRadius: "50%",
          width: "26px",
          height: "26px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "13px",
          cursor: "pointer",
          border: "2px solid #fff"
        }}
      >
        📷
      </div>
    )}

    <input
      type="file"
      ref={fileRef}
      onChange={handleGroupPicUpload}
      style={{ display: "none" }}
    />

  </div>

  {/* 🔽 TEXT SECTION (ALAG) */}
  <div style={{ textAlign: "center" }}>

    <h3 style={{ margin: "5px 0" }}>
      {friend.isGroup ? friend.name : friend.username}
    </h3>

    {friend.isGroup && (
      <>
        <p style={{ fontSize: "14px", margin: "2px 0", fontWeight: "600" }}>
          Admins: {membersArr.filter(m => m.is_admin).length > 0 
            ? membersArr.filter(m => m.is_admin).map(m => m.username).join(", ") 
            : (friend.admin_name || "Owner")} 👑
        </p>

        <p style={{ fontSize: "14px", opacity: 0.7 }}>
         Members: {membersArr.map(m => m.username).join(", ")}
        </p>
      </>
    )}

    {!friend.isGroup && <p>{friend.email}</p>}

  </div>

</div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tabButton, ...(activeTab === 'media' && styles.activeTab) }}
            onClick={() => setActiveTab('media')}
          >
            Media ({media.length})
          </button>
          <button
            style={{ ...styles.tabButton, ...(activeTab === 'links' && styles.activeTab) }}
            onClick={() => setActiveTab('links')}
          >
            Links ({links.length})
          </button>
          <button
            style={{ ...styles.tabButton, ...(activeTab === 'documents' && styles.activeTab) }}
            onClick={() => setActiveTab('documents')}
          >
            Doc ({documents.length})
          </button>
        </div>

        <div style={styles.content}>
          {activeTab === 'media' && (
            <div style={styles.mediaGrid}>
              {media.length > 0 ? (
                media.map(item => (
                  <div 
                    key={item.id} 
                    style={{ ...styles.mediaItem, cursor: 'pointer' }}
                    onClick={() => {
  setPreviewMedia({ url: item.url, type: item.type });

if (item.id) {
  socket.emit("messageOpened", {
    messageId: item.id
  });
} else {
  console.log("❌ No ID for delete:", item);
}
}}
                  >
                    {item.type === 'image' ? (
                      <img src={item.url} alt="Media" style={styles.mediaThumbnail} />
                    ) : (
                      <video src={item.url} style={styles.mediaThumbnail} />
                    )}
                  </div>
                ))
              ) : (
                <p>No media shared.</p>
              )}
            </div>
          )}

          {activeTab === 'links' && (
            <div style={styles.linksList}>
              {links.length > 0 ? (
                links.map(item => (
                  <div key={item.id} style={styles.linkItem}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
                    <p style={styles.linkContext}>{item.text}</p>
                  </div>
                ))
              ) : (
                <p>No links shared.</p>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div style={styles.documentsList}>
              {documents.length > 0 ? (
                documents.map(item => (
                  <div key={item.id} style={styles.documentItem}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name || item.url}</a>
                  </div>
                ))
              ) : (
                <p>No documents shared.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 🔥 FORWARD PICKER MODAL (Chat List for sending profile) */}
      {showForwardPicker && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', zIndex: 10001,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: '#fff', borderRadius: '15px', width: '90%', maxWidth: '400px', maxHeight: '70%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '15px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Send Profile to...</h3>
              <button onClick={() => setShowForwardPicker(false)} style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
              {friendsList.map(f => (
                <div key={f.id} onClick={() => sendProfileToFriend(f)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', cursor: 'pointer', borderBottom: '1px solid #f9f9f9' }}>
                  <img src={f.avatar || f.profile_pic} style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid #FFFC00' }} alt="" />
                  <span style={{ fontWeight: '500' }}>{f.username}</span>
                  <span style={{ marginLeft: 'auto', color: '#00B4F6' }}>Send ➤</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
{showGroupPicker && (
  <div style={popupStyles.overlay}>
    <div style={{ ...popupStyles.box, width: "350px" }}>
      
      <h3>Create Group</h3>

      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        {friendsList.map(f => (
          <div 
            key={f.id}
            onClick={() => toggleUserSelect(f)}
            style={{
              padding: "10px",
              cursor: "pointer",
              background: selectedUsers.find(u => u.id === f.id) ? "#e6f7ff" : "#fff"
            }}
          >
            {f.username}
          </div>
        ))}
      </div>

      <div style={popupStyles.actions}>
        <button onClick={() => setShowGroupPicker(false)}>Cancel</button>

        <button onClick={() => {
          if (selectedUsers.length === 0) {
            showToast("Select at least 1 user 👤");
            return;
          }
          setShowGroupPicker(false);
          setShowNamePopup(true);
        }}>
          Next
        </button>
      </div>

    </div>
  </div>
)}

{showAddMemberPicker && (
  <div style={popupStyles.overlay}>
    <div style={{ ...popupStyles.box, width: "350px" }}>
      <h3>Add Members</h3>
      <div style={{ maxHeight: "250px", overflowY: "auto", margin: "10px 0" }}>
        {friendsList.length > 0 ? friendsList.map(f => (
          <div 
            key={f.id}
            onClick={() => toggleUserSelect(f)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: "10px", cursor: "pointer",
              background: selectedUsers.find(u => u.id === f.id) ? "#e6f7ff" : "#fff",
              borderBottom: '1px solid #eee'
            }}
          >
            <img src={f.avatar || f.profile_pic} style={{ width: '30px', height: '30px', borderRadius: '50%' }} alt="" />
            <span style={{ flex: 1 }}>{f.username}</span>
            <input type="checkbox" checked={!!selectedUsers.find(u => u.id === f.id)} readOnly />
          </div>
        )) : <p style={{ textAlign: 'center', color: '#888', fontSize: '13px' }}>All friends are already in this group! 🌟</p>}
      </div>
      <div style={popupStyles.actions}>
        <button onClick={() => { setShowAddMemberPicker(false); setSelectedUsers([]); }}>Cancel</button>
        <button 
          disabled={selectedUsers.length === 0}
          onClick={handleAddMembers}
          style={{ 
            background: selectedUsers.length > 0 ? '#25D366' : '#ccc', 
            color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' 
          }}
        >
          Add ({selectedUsers.length})
        </button>
      </div>
    </div>
  </div>
)}

{showAdminTransferPicker && (
  <div style={popupStyles.overlay}>
    <div style={{ ...popupStyles.box, width: "350px" }}>
      <h3>Choose New Admin 👑</h3>
      <p style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>Select a member to take over as admin before you leave.</p>
      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        {(friend.members || friend.membersList)
          ?.filter(m => String(m.id) !== String(user.id))
          .map(m => (
            <div 
              key={m.id}
              onClick={() => handleTransferAndLeave(m.id)}
              style={{
                padding: "12px",
                cursor: "pointer",
                borderBottom: "1px solid #eee",
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}
            >
              <span style={{ flex: 1 }}>{m.username}</span>
              <span style={{ fontSize: '10px', background: '#00B4F6', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>SELECT</span>
            </div>
          ))}
      </div>
      <div style={popupStyles.actions}>
        <button onClick={() => setShowAdminTransferPicker(false)} style={{ margin: '0 auto' }}>Cancel</button>
      </div>
    </div>
  </div>
)}

{showRemoveMemberPicker && (
  <div style={popupStyles.overlay}>
    <div style={{ ...popupStyles.box, width: "380px" }}>
      <h3>Manage Members</h3>
      <div style={{ maxHeight: "300px", overflowY: "auto", marginTop: '10px' }}>
        {membersArr
          ?.filter(m => String(m.id) !== String(user.id)) 
          .map(m => (
            <div 
              key={m.id}
              style={{
                padding: "12px",
                borderBottom: "1px solid #eee",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "600" }}>{m.username} {m.is_admin ? "👑" : ""}</span>
                <span 
                  onClick={() => handleRemoveMember(m.id)}
                  style={{ color: 'red', fontWeight: 'bold', fontSize: '11px', cursor: "pointer", background: "#fee", padding: "4px 8px", borderRadius: "4px" }}
                >
                  REMOVE
                </span>
              </div>
              
              <div style={{ display: "flex", gap: "10px" }}>
                {m.is_admin ? (
                  <button 
                    onClick={() => handleDemoteMember(m.id)}
                    style={{ flex: 1, fontSize: "11px", padding: "6px", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Dismiss as Admin
                  </button>
                ) : (
                  <button 
                    onClick={() => handlePromoteMember(m.id)}
                    style={{ flex: 1, fontSize: "11px", padding: "6px", background: "#00B4F6", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Make Group Admin
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      <div style={popupStyles.actions}>
        <button onClick={() => setShowRemoveMemberPicker(false)} style={{ margin: '10px auto' }}>Close</button>
      </div>
    </div>
  </div>
)}

      {/* 🔥 MEDIA PREVIEW MODAL (LIGHTBOX) */}
      {previewMedia && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.9)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          onClick={() => setPreviewMedia(null)}
        >
          <button 
            onClick={() => setPreviewMedia(null)}
            style={{
              position: 'absolute', top: '20px', right: '20px',
              background: 'transparent', border: 'none', color: '#fff',
              fontSize: '30px', cursor: 'pointer'
            }}
          >✕</button>
          
          {previewMedia.type === 'image' ? (
            <img src={previewMedia.url} style={{ maxWidth: '95%', maxHeight: '90%', objectFit: 'contain' }} />
          ) : (
            <video src={previewMedia.url} controls autoPlay style={{ maxWidth: '95%', maxHeight: '90%' }} />
          )}
        </div>
      )}
    </div>
  );
};
const popupStyles = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999
  },
  box: {
    background: "#fff",
    padding: "20px",
    borderRadius: "10px",
    width: "300px"
  },
  input: {
    width: "100%",
    padding: "8px",
    marginTop: "10px"
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: "15px"
  }
};
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5000,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: '15px',
    width: '90%',
    maxWidth: '500px',
    height: '90%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '15px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f8f8f8',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    marginRight: '15px',
    color: '#333',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
  },
profileInfo: {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',   // 🔥 IMPORTANT
  padding: '20px',
  borderBottom: '1px solid #eee',
},
  avatar: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    objectFit: 'cover',
    marginBottom: '10px',
    border: '3px solid #FFFC00',
  },
  tabs: {
    display: 'flex',
justifyContent: 'center',
gap: '20px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f8f8f8',
  },
  tabButton: {
    flex: 1,
    padding: '12px 10px',
    border: 'none',
    background: 'none',
    fontSize: '15px',
    cursor: 'pointer',
    color: '#555',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    transition: 'all 0.2s ease',
  },
  activeTab: {
    color: '#00B4F6',
    borderBottomColor: '#00B4F6',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '15px',
  },
  mediaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: '10px',
  },
  mediaItem: {
    width: '100px',
    height: '100px',
    overflow: 'hidden',
    borderRadius: '8px',
    backgroundColor: '#eee',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  linksList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  linkItem: {
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    border: '1px solid #eee',
  },
  linkContext: {
    fontSize: '12px',
    color: '#777',
    marginTop: '5px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  documentsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  documentItem: {
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    border: '1px solid #eee',
  },
  menuButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#333',
    padding: '0 5px',
  },
  menuOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 5999,
  },
  popupMenu: {
    position: 'absolute',
    top: '35px',
    right: '0',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    zIndex: 6000,
    minWidth: '220px',
    padding: '8px 0',
    display: 'flex',
    flexDirection: 'column',
    animation: 'popIn 0.2s ease-out',
  },
  menuItem: {
    padding: '12px 16px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'background 0.2s',
  },
  menuSeparator: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '4px 0',
  },
  toggleTrack: {
    width: '34px',
    height: '18px',
    borderRadius: '10px',
    backgroundColor: '#ccc',
    position: 'relative',
    transition: 'background-color 0.2s',
  },
  toggleTrackActive: {
    backgroundColor: '#25D366',
  },
  toggleThumb: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#fff',
    position: 'absolute',
    top: '2px',
    left: '2px',
    transition: 'left 0.2s',
  },
  toggleThumbActive: {
    left: '18px',
  },
};

export default FriendProfileView;



//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg