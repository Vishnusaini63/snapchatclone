require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const verifyToken = require("./middleware/authMiddleware");
require("./config/Message"); // Auto-create tables
require("./config/User");

// 🔥 NEW: Ensure chat_settings table exists
db.query(
  `
  CREATE TABLE IF NOT EXISTS chat_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user1 INT NOT NULL,
    user2 INT NOT NULL,
    delete_mode VARCHAR(50) DEFAULT 'never',
    is_global TINYINT(1) DEFAULT 0,
    owner_id INT DEFAULT NULL,
    UNIQUE KEY (user1, user2, is_global, owner_id)
  )
`,
  (err) => {
    if (err) console.error("❌ Chat settings table error:", err);
  },
);

// 🔥 Ensure mute_settings table exists
db.query(
  `
  CREATE TABLE IF NOT EXISTS mute_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    friend_id INT NOT NULL,
    is_chat_muted TINYINT(1) DEFAULT 0,
    is_call_muted TINYINT(1) DEFAULT 0,
    UNIQUE KEY (user_id, friend_id)
  )
`,
  (err) => {
    if (err) console.error("❌ Mute settings table error:", err);
  },
);

// 🔥 Ensure is_admin column exists in group_members for multiple admins
db.query(
  `
  SELECT 1 FROM information_schema.columns 
  WHERE table_schema = DATABASE() 
  AND table_name = 'group_members' 
  AND column_name = 'is_admin'
`,
  (err, results) => {
    if (err) {
      console.error("❌ Error checking for group_members is_admin column:", err);
    } else if (results.length === 0) {
      db.query(
        `ALTER TABLE group_members ADD COLUMN is_admin TINYINT(1) DEFAULT 0`,
        (alterErr) => {
          if (!alterErr) {
            db.query("UPDATE group_members gm JOIN chat_groups g ON gm.group_id = g.id AND gm.user_id = g.created_by SET gm.is_admin = 1");
          }
        },
      );
    }
  },
);

// 🔥 Ensure is_group column exists in messages table (FIXED for MySQL versions that don't support IF NOT EXISTS with ALTER TABLE ADD COLUMN)
db.query(
  `
  SELECT 1 FROM information_schema.columns 
  WHERE table_schema = DATABASE() 
  AND table_name = 'messages' 
  AND column_name = 'is_group'
`,
  (err, results) => {
    if (err) {
      console.error("❌ Error checking for is_group column:", err);
    } else if (results.length === 0) {
      db.query(
        `ALTER TABLE messages ADD COLUMN is_group TINYINT(1) DEFAULT 0`,
        (alterErr) => {
          if (alterErr)
            console.error("❌ Alter messages table error:", alterErr);
        },
      );
    }
  },
);

// � Ensure uploads directory exists to prevent ENOENT errors
const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 📁 storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1000 * 1024 * 1024 }, // 🔥 Increased to 10MB for high-res photos
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["audio/", "image/", "video/", "application/pdf"];

    const isValid = allowedTypes.some((type) => file.mimetype.startsWith(type));

    if (isValid) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file ❌"), false);
    }
  },
});

const inCallUsers = new Set(); // 🔥 track busy users
const app = express();
const busyUsers = {};
// middleware
app.use(cors());
app.use(express.json());

app.use(
  "/uploads",
  express.static("uploads", {
    setHeaders: (res, path) => {
      if (path.endsWith(".webm")) {
        res.setHeader("Content-Type", "audio/webm");
      }
    },
  }),
);

// routes
app.use("/api/auth", authRoutes);

app.post("/api/group/create", async (req, res) => {
  try {
    // ✅ SABSE PEHLE YE
    const { name, members, creator } = req.body;

    console.log("REQ:", name, members, creator);

    const safeMembers = Array.isArray(members) ? members : [];

    // ✅ AB USE KAR
    const allMembers = [...safeMembers, creator];

    const [result] = await db
      .promise()
      .query("INSERT INTO chat_groups (name, created_by) VALUES (?, ?)", [
        name,
        creator,
      ]);

    const groupId = result.insertId;

    for (let userId of allMembers) {
      const isAdmin = String(userId) === String(creator) ? 1 : 0;
      await db
        .promise()
        .query("INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)", [
          groupId,
          userId,
          isAdmin
        ]);
    }

    const group = {
      id: groupId,
      name,
      created_by: creator, // 🔥 IMPORTANT: Emit creator ID
      members: allMembers,
      isGroup: true,
    };

    io.emit("groupCreated", group);

    res.json(group);
  } catch (err) {
    console.error("🔥 GROUP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
// 🔥 NEW: Handle Reject Friend Request (Fixes 404 Error)
app.post("/api/auth/reject-request", verifyToken, (req, res) => {
  const { senderId, requestId } = req.body;
  const receiverId = req.user.id; // verifyToken middleware se user ID

  // Agar requestId hai toh usse delete karo, nahi toh sender/receiver combo se
  const targetId = requestId || senderId;
  if (!targetId) return res.status(400).json({ error: "ID is required" });

  db.query(
    "DELETE FROM friends WHERE (id = ? OR (sender_id = ? AND receiver_id = ?)) AND status = 'pending'",
    [targetId, targetId, receiverId],
    (err, result) => {
      if (err) {
        console.error("❌ Reject request error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ success: true, message: "Friend request rejected ✅" });
    },
  );
});


app.post("/api/group/upload-pic", upload.single("image"), async (req, res) => {
  try {
    const { groupId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No file ❌" });
    }

    const filePath = `/uploads/${req.file.filename}`;

    await db.promise().query(
      "UPDATE chat_groups SET group_pic=? WHERE id=?",
      [filePath, groupId]
    );

    // 🔥 realtime sabko
    io.to(String(groupId)).emit("groupPicUpdated", {
      groupId,
      group_pic: "http://localhost:5000" + filePath
    });

    res.json({
      success: true,
      group_pic: "http://localhost:5000" + filePath
    });

  } catch (err) {
    console.error("Group pic error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/group/messages/:groupId", async (req, res) => {
  const [rows] = await db.promise().query(
    `SELECT m.*, u.username AS sender_name
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.receiver_id=? AND m.is_group=1
     ORDER BY m.created_at ASC`,
    [req.params.groupId]
  );

  res.json(rows);
});

app.get("/api/group/my/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [groups] = await db.promise().query(`
      SELECT 
        g.id, 
        g.name, 
        g.created_by,
        g.group_pic,
        u.username AS admin_name,
        GROUP_CONCAT(CONCAT(u2.id, ':', u2.username, ':', gm.is_admin)) AS members_raw,
        1 as isGroup
      FROM chat_groups g
      JOIN group_members gm ON g.id = gm.group_id
      JOIN users u ON u.id = g.created_by
      JOIN users u2 ON u2.id = gm.user_id
      WHERE g.id IN (
        SELECT group_id FROM group_members WHERE user_id = ?
      )
      GROUP BY g.id
    `, [userId]);

    // 🔥 YAHI ADD KAR (IMPORTANT)
    const result = groups.map(g => ({
      ...g,
      group_pic: g.group_pic
        ? `${req.protocol}://${req.get("host")}${g.group_pic}`
        : null,
      membersList: g.members_raw ? g.members_raw.split(',').map(m => {
        const parts = m.split(':');
        return { 
          id: parts[0], 
          username: parts[1], 
          is_admin: parts[2] === '1' 
        };
      }) : []
    }));

    res.json(result);

  } catch (err) {
    console.error("GROUP FETCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🔥 NEW: Leave Group (For everyone)
app.delete("/api/group/leave", verifyToken, async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    // Remove user from members list
    await db.promise().query("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);

    // Notify all members that someone left
    io.to(String(groupId)).emit("memberLeft", { groupId, userId });

    res.json({ success: true, message: "Left group successfully ✅" });
  } catch (err) {
    console.error("LEAVE GROUP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Rename Group (Admin only)
app.put("/api/group/rename", verifyToken, async (req, res) => {
  try {
    const { groupId, newName, adminId } = req.body;

    // Check if group exists
    const [group] = await db.promise().query("SELECT created_by FROM chat_groups WHERE id = ?", [groupId]);
    
    if (!group.length) {
      return res.status(404).json({ error: "Group not found 🚫" });
    }

    // Group name update karo
    await db.promise().query("UPDATE chat_groups SET name = ? WHERE id = ?", [newName, groupId]);

    // Saare group members ko real-time notification bhejo
    io.to(String(groupId)).emit("groupRenamed", { groupId, newName });

    res.json({ success: true, message: "Group renamed ✅" });
  } catch (err) {
    console.error("RENAME GROUP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Delete Group (Admin only)
app.delete("/api/group/delete", verifyToken, async (req, res) => {
  try {
    const { groupId, adminId } = req.body;

    // Check if requester is admin
    const [group] = await db.promise().query("SELECT created_by FROM chat_groups WHERE id = ?", [groupId]);
    
    if (!group.length || String(group[0].created_by) !== String(adminId)) {
      return res.status(403).json({ error: "Only admin can delete the group 🚫" });
    }

    // 1. Delete members mapping
    await db.promise().query("DELETE FROM group_members WHERE group_id = ?", [groupId]);
    
    // 2. Delete group messages
    await db.promise().query("DELETE FROM messages WHERE receiver_id = ? AND is_group = 1", [groupId]);

    // 3. Delete group itself
    await db.promise().query("DELETE FROM chat_groups WHERE id = ?", [groupId]);

    // Notify all members via socket
    io.emit("groupDeleted", { groupId });

    res.json({ success: true, message: "Group deleted successfully ✅" });
  } catch (err) {
    console.error("DELETE GROUP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Add Members to Group
app.post("/api/group/member/add", verifyToken, async (req, res) => {
  try {
    const { groupId, userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "Select at least one user 👤" });
    }

    for (let userId of userIds) {
      await db.promise().query(
        "INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
        [groupId, userId]
      );
    }

    // Updated members list fetch karo sync ke liye
    const [members] = await db.promise().query(
      `SELECT u.id, u.username, gm.is_admin FROM group_members gm 
       JOIN users u ON gm.user_id = u.id 
       WHERE gm.group_id = ?`, 
      [groupId]
    );

    io.emit("groupMembersUpdatedGlobal", { groupId, newMembersList: members });

    res.json({ success: true, message: "Members added ✅", members });
  } catch (err) {
    console.error("ADD MEMBER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Promote Member to Admin
app.post("/api/group/member/promote", verifyToken, async (req, res) => {
  try {
    const { groupId, memberId } = req.body;
    const adminId = req.user.id;

    const [check] = await db.promise().query(
      "SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?",
      [groupId, adminId]
    );

    if (!check.length || !check[0].is_admin) {
      return res.status(403).json({ error: "Only admins can promote members 🚫" });
    }

    await db.promise().query(
      "UPDATE group_members SET is_admin = 1 WHERE group_id = ? AND user_id = ?",
      [groupId, memberId]
    );

    const [members] = await db.promise().query(
      `SELECT u.id, u.username, gm.is_admin FROM group_members gm 
       JOIN users u ON gm.user_id = u.id 
       WHERE gm.group_id = ?`, 
      [groupId]
    );

    io.to(String(groupId)).emit("groupMembersUpdatedGlobal", { groupId, newMembersList: members });
    res.json({ success: true, message: "Member promoted to admin ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Demote Admin to Member
app.post("/api/group/member/demote", verifyToken, async (req, res) => {
  try {
    const { groupId, memberId } = req.body;
    const adminId = req.user.id;

    const [check] = await db.promise().query(
      "SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?",
      [groupId, adminId]
    );

    if (!check.length || !check[0].is_admin) {
      return res.status(403).json({ error: "Only admins can demote members 🚫" });
    }

    // Prevent demoting the group creator (owner)
    const [group] = await db.promise().query("SELECT created_by FROM chat_groups WHERE id = ?", [groupId]);
    if (String(memberId) === String(group[0].created_by)) {
      return res.status(400).json({ error: "Cannot demote the group creator ❌" });
    }

    await db.promise().query(
      "UPDATE group_members SET is_admin = 0 WHERE group_id = ? AND user_id = ?",
      [groupId, memberId]
    );

    const [members] = await db.promise().query(
      `SELECT u.id, u.username, gm.is_admin FROM group_members gm 
       JOIN users u ON gm.user_id = u.id 
       WHERE gm.group_id = ?`, 
      [groupId]
    );

    io.to(String(groupId)).emit("groupMembersUpdatedGlobal", { groupId, newMembersList: members });
    res.json({ success: true, message: "Admin rights removed ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Transfer Admin Rights and then Leave
app.post("/api/group/transfer-and-leave", verifyToken, async (req, res) => {
  try {
    const { groupId, userId, newAdminId } = req.body;

    // 1. Check if user is actually the admin
    const [group] = await db.promise().query("SELECT created_by FROM chat_groups WHERE id = ?", [groupId]);
    
    if (!group.length || String(group[0].created_by) !== String(userId)) {
      return res.status(403).json({ error: "Only admin can transfer ownership 🚫" });
    }

    // 2. Update created_by to new member
    await db.promise().query("UPDATE chat_groups SET created_by = ? WHERE id = ?", [newAdminId, groupId]);

    // 3. Remove old admin from group members
    await db.promise().query("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);

    // 4. Notify everyone
    io.to(String(groupId)).emit("adminTransferredGlobal", { groupId, newAdminId, oldAdminId: userId });
    io.to(String(groupId)).emit("memberLeft", { groupId, userId });

    res.json({ success: true, message: "Admin rights transferred and you left ✅" });
  } catch (err) {
    console.error("ADMIN TRANSFER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Add Members to Group
app.post("/api/group/member/add", verifyToken, async (req, res) => {
  try {
    const { groupId, userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "Select at least one user 👤" });
    }

    for (let userId of userIds) {
      await db.promise().query(
        "INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
        [groupId, userId]
      );
    }

    // Updated members list fetch karo sync ke liye
    const [members] = await db.promise().query(
      `SELECT u.id, u.username, gm.is_admin FROM group_members gm 
       JOIN users u ON gm.user_id = u.id 
       WHERE gm.group_id = ?`, 
      [groupId]
    );

    io.emit("groupMembersUpdatedGlobal", { groupId, newMembersList: members });

    res.json({ success: true, message: "Members added ✅", members });
  } catch (err) {
    console.error("ADD MEMBER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Remove Member from Group (Admin only)
app.delete("/api/group/member/remove", verifyToken, async (req, res) => {
  try {
    const { groupId, memberId, adminId } = req.body;

    // Check if requester is admin
    const [group] = await db.promise().query("SELECT created_by FROM chat_groups WHERE id = ?", [groupId]);
    
    if (!group.length || String(group[0].created_by) !== String(adminId)) {
      return res.status(403).json({ error: "Only admin can remove members 🚫" });
    }

    // Admin cannot remove themselves
    if (String(memberId) === String(adminId)) {
      return res.status(400).json({ error: "Admin cannot remove themselves ❌" });
    }

    await db.promise().query("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, memberId]);

    // Notify room members
    io.to(String(groupId)).emit("memberRemoved", { groupId, memberId });

    res.json({ success: true, message: "Member removed from group ✅" });
  } catch (err) {
    console.error("REMOVE MEMBER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/messages/history/:user1/:user2", (req, res) => {
  const { user1, user2 } = req.params;
  const isGroup = req.query.isGroup === "true";

  let sql;

  if (isGroup) {
    sql = `
      SELECT m.*, u.username AS sender_name, null as edited_text
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.receiver_id = ${db.escape(user2)} AND m.is_group = 1
      ORDER BY m.created_at ASC
    `;
  } else {
    sql = `
      SELECT m.*, u.username AS sender_name, em.edited_text
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN edited_messages em 
        ON m.id = em.message_id AND em.user_id = ${db.escape(user1)}
      WHERE (
        (m.sender_id = ${db.escape(user1)} AND m.receiver_id = ${db.escape(user2)}) 
        OR 
        (m.sender_id = ${db.escape(user2)} AND m.receiver_id = ${db.escape(user1)})
      )
      AND m.is_group = 0
      AND m.id NOT IN (
        SELECT message_id FROM deleted_messages WHERE user_id = ${db.escape(user1)}
      )
      ORDER BY m.created_at ASC
    `;
  }

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.delete("/api/friends/remove", (req, res) => {
  const { userId, friendId } = req.body;

  // 🔥 STEP 1: Remove Friend Relation
  db.query(
    `DELETE FROM friends 
     WHERE (sender_id = ? AND receiver_id = ?) 
     OR (sender_id = ? AND receiver_id = ?)`,
    [userId, friendId, friendId, userId],
    (err) => {
      if (err) {
        console.error("❌ Friend remove error:", err);
        return res.status(500).json({ error: "Failed to remove friend" });
      }

      // 🔥 STEP 2: Delete Chat Messages
      db.query(
        `DELETE FROM messages 
         WHERE (sender_id = ? AND receiver_id = ?) 
         OR (sender_id = ? AND receiver_id = ?)`,
        [userId, friendId, friendId, userId],
        (err2) => {
          if (err2) {
            console.error("❌ Chat delete error:", err2);
            return res.status(500).json({ error: "Failed to delete chat" });
          }

          // 🔥 STEP 3: Cleanup deleted_messages table
          db.query(
            `DELETE FROM deleted_messages 
             WHERE user_id IN (?, ?)`,
            [userId, friendId],
            (err3) => {
              if (err3) {
                console.error("❌ deleted_messages cleanup error:", err3);
              }

              // 🔥 STEP 4: Cleanup edited_messages table
              db.query(
                `DELETE FROM edited_messages 
                 WHERE user_id IN (?, ?)`,
                [userId, friendId],
                (err4) => {
                  if (err4) {
                    console.error("❌ edited_messages cleanup error:", err4);
                  }

                  // ✅ FINAL RESPONSE
                  res.json({
                    success: true,
                    message: "Friend + chat पूरी तरह delete हो गया 🔥",
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

app.post("/api/friends/block", (req, res) => {
  const { userId, friendId } = req.body;

  // 🔥 STEP 1: Pehle purana koi bhi relation delete karo aur naya 'blocked' record dalo
  // Jisme userId (blocker) sender_id banega.
  db.query(
    "DELETE FROM friends WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)",
    [userId, friendId, friendId, userId],
    (err) => {
      if (err) return res.status(500).json({ error: "Block failed" });

      db.query(
        "INSERT INTO friends (sender_id, receiver_id, status) VALUES (?, ?, 'blocked')",
        [userId, friendId],
        (err2) => {
          if (err2) return res.status(500).json({ error: "Block failed" });

          // 🔥 STEP 2: Chat delete karo
          db.query(
            "DELETE FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)",
            [userId, friendId, friendId, userId],
            (err3) => {
              if (err3) console.error("Chat delete error:", err3);
              res.json({ success: true, message: "User blocked 🚫" });
            },
          );
        },
      );
    },
  );
});

app.get("/api/friends/blocked/:userId", (req, res) => {
  const { userId } = req.params;

  db.query(
    `SELECT u.id, u.username, u.profile_pic
     FROM friends f
     JOIN users u ON u.id = f.receiver_id
     WHERE f.sender_id=? 
     AND f.status='blocked'`,
    [userId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});

app.post("/api/friends/nickname", (req, res) => {
  const { userId, friendId, nickname } = req.body;

  const sql = `
    INSERT INTO friend_nicknames (user_id, friend_id, nickname)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE nickname = ?
  `;

  db.query(sql, [userId, friendId, nickname, nickname], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to save nickname" });
    }

    res.json({ success: true });
  });
});

app.post("/api/friends/unblock", (req, res) => {
  const { userId, friendId } = req.body;

  db.query(
    "DELETE FROM friends WHERE sender_id=? AND receiver_id=? AND status='blocked'",
    [userId, friendId],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Unblock failed" });
      }

      res.json({ success: true, message: "User unblocked ✅" });
    },
  );
});

// 🔥 NEW: Get unread counts for Sidebar
app.get("/api/messages/unread-counts/:userId", (req, res) => {
  const { userId } = req.params;
  const sql = `
    SELECT 
      IF(is_group = 1, receiver_id, sender_id) as conversation_id, 
      COUNT(*) as count 
    FROM messages 
    WHERE (receiver_id = ? AND is_group = 0 AND status != 'read')
       OR (is_group = 1 AND status != 'read' AND sender_id != ? AND receiver_id IN (
         SELECT group_id FROM group_members WHERE user_id = ?
       ))
    GROUP BY conversation_id
  `;

  db.query(sql, [userId, userId, userId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 🔥 NEW: Get the last message for each conversation for Sidebar
app.get("/api/messages/last-messages/:userId", (req, res) => {
  const { userId } = req.params;
  const sql = `
    SELECT m.*, IF(m.sender_id = ?, m.receiver_id, m.sender_id) as friend_id
    FROM messages m
    INNER JOIN (
        SELECT 
            IF(sender_id = ?, receiver_id, sender_id) AS conversation_id,
            MAX(id) as max_id
        FROM messages
        WHERE sender_id = ? OR receiver_id = ?
        GROUP BY conversation_id
    ) latest ON m.id = latest.max_id
  `;
  db.query(sql, [userId, userId, userId, userId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

app.post("/api/chat/mute-settings", (req, res) => {
  const { userId, friendId, isChatMuted, isCallMuted } = req.body;

  const sql = `
    INSERT INTO mute_settings (user_id, friend_id, is_chat_muted, is_call_muted)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      is_chat_muted = VALUES(is_chat_muted), 
      is_call_muted = VALUES(is_call_muted)
  `;

  db.query(
    sql,
    [userId, friendId, isChatMuted ? 1 : 0, isCallMuted ? 1 : 0],
    (err, result) => {
      if (err) {
        console.log("❌ DB ERROR:", err);
        return res.status(500).json({ error: err.message });
      }

      console.log("🔥 RESULT:", result); // 👈 ADD THIS

      if (result.affectedRows === 0) {
        console.log("⚠️ NO ROW UPDATED");
      } else {
        console.log("✅ ROW UPDATED");
      }

      io.emit("muteSettingsUpdated", {
        userId: Number(userId),
        friendId: Number(friendId),
        isChatMuted,
        isCallMuted,
      });

      res.json({ success: true });
    },
  );
});

app.get("/api/chat/mute-settings/:userId/:friendId", (req, res) => {
  const { userId, friendId } = req.params;
  db.query(
    "SELECT is_chat_muted as isChatMuted, is_call_muted as isCallMuted FROM mute_settings WHERE user_id = ? AND friend_id = ?",
    [userId, friendId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result[0] || { isChatMuted: false, isCallMuted: false });
    },
  );
});

app.get("/api/chat/mute-settings/all/:userId", (req, res) => {
  const { userId } = req.params;
  db.query(
    "SELECT friend_id, is_chat_muted, is_call_muted FROM mute_settings WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

app.use("/api/messages", messageRoutes);

// 🔥 Updated to use upload.single("image") to match frontend field name
app.post("/api/upload-profile", upload.single("image"), (req, res) => {
  console.log("FILE:", req.file);

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  res.json({ url: `${req.protocol}://${req.get("host")}${filePath}` });
});

//  IMPORTANT: http server create
const server = http.createServer(app);

// 👇 socket setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});


app.use(express.static(path.join(__dirname, "../snapchat-frontend/dist")));

app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "../snapchat-frontend/dist/index.html"));
});
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});

// 🔥 AUTO DELETE JOB (ADD HERE)
setInterval(async () => {
  try {
    await db
      .promise()
      .query(
        "DELETE FROM messages WHERE delete_at IS NOT NULL AND delete_at <= NOW()",
      );
  } catch (err) {
    console.error("Auto delete error:", err);
  }
}, 60000); // every 1 min
const users = {}; // userId → socketId map
const activeChatRooms = {}; // userId → friendId (current active chat)

// 🎤 AUDIO UPLOAD API
app.post("/api/upload-audio", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  const fullUrl = "http://localhost:5000" + filePath;

  res.json({ url: fullUrl });
});

// 📸 IMAGE/VIDEO UPLOAD API
app.post("/api/upload-media", upload.single("media"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  res.json({
    url: "http://localhost:5000" + filePath,
    type: req.file.mimetype.split("/")[0],
  });
});

app.post("/api/chat/wallpaper", upload.single("wallpaper"), (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "No file uploaded or invalid format" });
  }

  let { user1, user2, type, isGroup } = req.body; // type = "me" | "everyone", isGroup

  const filePath = `/uploads/${req.file.filename}`;
  const fullUrl = "http://localhost:5000" + filePath;

  const u1 = isGroup === "true" ? 0 : Math.min(Number(user1), Number(user2));
  const u2 =
    isGroup === "true" ? Number(user2) : Math.max(Number(user1), Number(user2));

  if (type === "everyone") {
    db.query(
      "REPLACE INTO chat_wallpapers (user1, user2, wallpaper, is_global) VALUES (?, ?, ?, 1)",
      [u1, u2, filePath],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });

        const payload = {
          url: fullUrl,
          senderId: user1,
          isGroup: isGroup === "true",
          groupId: user2,
        };

        if (isGroup === "true") {
          io.to(String(user2)).emit("wallpaperUpdated", payload);

          // 🔥 fallback
          io.emit("wallpaperUpdatedGlobal", {
            url: fullUrl,
            groupId: user2,
          });
        } else {
          const s1 = users[String(user1)];
          const s2 = users[String(user2)];
          if (s1) io.to(s1).emit("wallpaperUpdated", payload);
          if (s2) io.to(s2).emit("wallpaperUpdated", payload);
        }
        res.json({ url: fullUrl });
      },
    );
  } else {
    // 🔥 FOR ME
    db.query(
      `INSERT INTO chat_wallpapers (user1, user2, wallpaper, is_global, owner_id) 
       VALUES (?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE wallpaper = VALUES(wallpaper)`,
      [u1, u2, filePath, Number(user1)],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ url: fullUrl });
      },
    );
  }
});

app.get("/api/chat/wallpaper/:user1/:user2", (req, res) => {
  const { user1, user2 } = req.params;
  const isGroup = req.query.isGroup === "true";

  const u1 = isGroup ? 0 : Math.min(user1, user2);
  const u2 = isGroup ? user2 : Math.max(user1, user2);

  const sql = `
    SELECT wallpaper FROM chat_wallpapers 
    WHERE 
      (is_global = 1 AND user1=? AND user2=?)
      OR
      (is_global = 0 AND owner_id=? AND user1=? AND user2=?)
    ORDER BY id DESC
    LIMIT 1
  `;

  db.query(sql, [u1, u2, user1, u1, u2], (err, result) => {
    if (result.length) {
      res.json({
        wallpaper: "http://localhost:5000" + result[0].wallpaper,
      });
    } else {
      res.json({ wallpaper: null });
    }
  });
});

app.post("/api/chat/theme", async (req, res) => {
  let { user1, user2, theme, type, isGroup } = req.body;

  const u1 = isGroup === "true" ? 0 : Math.min(Number(user1), Number(user2));
  const u2 =
    isGroup === "true" ? Number(user2) : Math.max(Number(user1), Number(user2));
  const ownerId = Number(user1);

  try {
    if (type === "everyone") {
      // Everyone: Pehle sab purana clear karo
      await db
        .promise()
        .query("DELETE FROM chat_themes WHERE user1=? AND user2=?", [u1, u2]);
      await db
        .promise()
        .query("DELETE FROM chat_wallpapers WHERE user1=? AND user2=?", [
          u1,
          u2,
        ]);
      await db
        .promise()
        .query(
          "INSERT INTO chat_themes (user1, user2, theme, is_global) VALUES (?, ?, ?, 1)",
          [u1, u2, theme],
        );

      if (isGroup === "true") {
        // ✅ group room broadcast
        io.to(String(user2)).emit("themeUpdated", {
          theme,
          isGroup: true,
          groupId: user2,
          senderId: user1,
        });

        // 🔥 EXTRA SAFETY (VERY IMPORTANT)
        io.emit("themeUpdatedGlobal", {
          theme,
          groupId: user2,
        });
      } else {
        const s1 = users[String(user1)];
        const s2 = users[String(user2)];
        if (s1)
          io.to(s1).emit("themeUpdated", {
            theme,
            isGroup: false,
            senderId: user1,
          });
        if (s2)
          io.to(s2).emit("themeUpdated", {
            theme,
            isGroup: false,
            senderId: user1,
          });
      }
      res.json({ success: true });
    } else {
      // For Me: Sirf apna private record clear aur insert karo
      await db
        .promise()
        .query(
          "DELETE FROM chat_themes WHERE is_global=0 AND owner_id=? AND user1=? AND user2=?",
          [ownerId, u1, u2],
        );
      await db
        .promise()
        .query(
          "DELETE FROM chat_wallpapers WHERE is_global=0 AND owner_id=? AND user1=? AND user2=?",
          [ownerId, u1, u2],
        );
      await db.promise().query(
        `INSERT INTO chat_themes (user1, user2, theme, is_global, owner_id)
   VALUES (?, ?, ?, 0, ?)
   ON DUPLICATE KEY UPDATE theme = VALUES(theme), owner_id = VALUES(owner_id)`,
        [u1, u2, theme, ownerId],
      );
      res.json({ success: true });
    }
  } catch (err) {
    console.error("Theme Save Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/chat/theme/:user1/:user2", (req, res) => {
  const isGroup = req.query.isGroup === "true";
  const u1 = isGroup
    ? 0
    : Math.min(Number(req.params.user1), Number(req.params.user2));
  const u2 = isGroup
    ? Number(req.params.user2)
    : Math.max(Number(req.params.user1), Number(req.params.user2));
  const currentUserId = Number(req.params.user1);

  // 🔥 PRIVATE FIRST
  const sqlPrivate = `
    SELECT theme FROM chat_themes 
    WHERE is_global = 0 AND owner_id=? AND user1=? AND user2=?
    ORDER BY id DESC
    LIMIT 1
  `;

  db.query(sqlPrivate, [currentUserId, u1, u2], (err, privateResult) => {
    if (err) return res.status(500).send(err);

    if (privateResult.length > 0) {
      return res.json({ theme: privateResult[0].theme });
    }

    // 🔥 GLOBAL
    const sqlGlobal = `
      SELECT theme FROM chat_themes 
      WHERE is_global = 1 AND user1=? AND user2=?
      ORDER BY id DESC
      LIMIT 1
    `;

    db.query(sqlGlobal, [u1, u2], (err2, globalResult) => {
      if (err2) return res.status(500).send(err2);

      res.json({
        theme: globalResult.length ? globalResult[0].theme : "default",
      });
    });
  });
});

// 🔥 NEW: Save Delete Mode preference for a chat
app.post("/api/chat/delete-mode", async (req, res) => {
  let { user1, user2, userId, friendId, deleteMode, type, isGroup } = req.body;
  const isGroupBool = isGroup === true || isGroup === 'true';

  const id1 = user1 || userId;
  const id2 = user2 || friendId;

  if (!id1 || !id2) return res.status(400).json({ error: "User IDs are required ❌" });

  const u1 = isGroupBool ? 0 : Math.min(Number(id1), Number(id2));
  const u2 = isGroupBool ? Number(id2) : Math.max(Number(id1), Number(id2));
  const ownerId = Number(id1);

  try {
    if (type === "everyone") {
      // Use ON DUPLICATE KEY UPDATE to prevent 500 errors and handle unique constraints
      await db.promise().query(
        `INSERT INTO chat_settings (user1, user2, delete_mode, is_global) 
         VALUES (?, ?, ?, 1) 
         ON DUPLICATE KEY UPDATE delete_mode = VALUES(delete_mode)`,
        [u1, u2, deleteMode || "never"]
      );

      // Notify both clients via socket
      const payload = { deleteMode, senderId: id1, isGroup: isGroupBool, groupId: id2 };
      if (isGroupBool) {
        io.to(String(id2)).emit("deleteModeUpdated", payload);
      } else {
        const s1 = users[String(id1)];
        const s2 = users[String(id2)];
        if (s1) io.to(s1).emit("deleteModeUpdated", payload);
        if (s2) io.to(s2).emit("deleteModeUpdated", payload);
      }
      res.json({
        success: true,
        message: "Delete mode updated for everyone ✅",
      });
    } else {
      // For Me: Sirf apna private record update/insert karo
      await db.promise().query(
        `INSERT INTO chat_settings (user1, user2, delete_mode, is_global, owner_id) 
         VALUES (?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE delete_mode = VALUES(delete_mode)`,
        [u1, u2, deleteMode || "never", ownerId],
      );
      res.json({ success: true, message: "Delete mode updated for you ✅" });
    }
  } catch (err) {
    console.error("Delete Mode Save Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 NEW: Get Delete Mode preference
app.get("/api/chat/delete-mode/:user1/:user2", async (req, res) => {
  const isGroup = req.query.isGroup === "true" || req.query.isGroup === true;
  const u1 = isGroup ? 0 : Math.min(Number(req.params.user1), Number(req.params.user2));
  const u2 = isGroup ? Number(req.params.user2) : Math.max(Number(req.params.user1), Number(req.params.user2));
  const currentUserId = Number(req.params.user1);

  try {
    const sql = `
      SELECT delete_mode FROM chat_settings 
      WHERE (is_global = 1 AND user1=? AND user2=?)
      OR (is_global = 0 AND owner_id=? AND user1=? AND user2=?)
      ORDER BY is_global DESC, id DESC LIMIT 1
    `;

    const [result] = await db.promise().query(sql, [u1, u2, currentUserId, u1, u2]);
    res.json({ deleteMode: result.length ? result[0].delete_mode : "never" });
  } catch (err) {
    console.error("GET Delete Mode Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/update-profile", verifyToken, (req, res) => {
  try {
    console.log("Profile Update Request Body:", req.body);

    if (!req.body || Object.keys(req.body).length === 0) {
      console.error("Update failed: Request body is empty");
      return res
        .status(400)
        .json({ error: "No data received. Ensure you are sending JSON." });
    }
    const {
      userId,
      username,
      email,
      dob,
      city,
      bio,
      profile_pic,
      active_status,
      read_receipts,
      two_factor_auth,
    } = req.body;
    const id = userId || req.body.id; // Support both 'userId' and 'id'

    if (!id) {
      console.error("Update failed: User ID is missing from request body");
      return res.status(400).json({ error: "User ID is required" });
    }

    let fields = [];
    let values = [];

    // 🔥 SAFE CHECKS
    if (username && username.trim() !== "") {
      fields.push("username=?");
      values.push(username);
    }

    if (email && email.trim() !== "") {
      fields.push("email=?");
      values.push(email);
    }

    if (dob && dob !== "" && dob !== "Invalid Date") {
      fields.push("dob=?");
      values.push(dob);
    }

    if (city && city.trim() !== "") {
      fields.push("city=?");
      values.push(city);
    }

    if (bio && bio.trim() !== "") {
      fields.push("bio=?");
      values.push(bio);
    }

    if (profile_pic && profile_pic !== "") {
      fields.push("profile_pic=?");
      values.push(profile_pic);
    }
    if (active_status !== undefined) {
      fields.push("active_status=?");
      values.push(active_status);
    }
    if (read_receipts !== undefined) {
      fields.push("read_receipts=?");
      values.push(read_receipts);
    }

    if (two_factor_auth !== undefined) {
      fields.push("two_factor_auth=?");
      values.push(two_factor_auth);
    }

    if (fields.length === 0) {
      console.error("Update failed: No fields provided for update");
      return res.status(400).json({ error: "No data to update" });
    }

    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id=?`;
    values.push(id);

    console.log("SQL:", sql);
    console.log("VALUES:", values);

    db.query(sql, values, (err) => {
      if (err) {
        console.log("DB ERROR:", err);
        return res.status(500).json({ error: err.message });
      }

      res.json({ message: "Profile updated successfully ✅" });
    });
  } catch (err) {
    console.log("SERVER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/user/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM users WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json(err);

    res.json(result[0]);
  });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  let currentUserId = null;
  // 🔥 Track when a user enters a specific chat
  socket.on("enterChat", ({ userId, friendId, isGroup }) => {
    const sUserId = String(userId);
    const sFriendId = String(friendId);
    activeChatRooms[sUserId] = sFriendId;

    // 🔥 1-to-1 Logic
    if (!isGroup) {
      db.query("SELECT active_status FROM users WHERE id = ?", [userId], (err, results) => {
        if (err || !results.length || !results[0].active_status) return;
        const friendSocket = users[sFriendId];
        if (activeChatRooms[sFriendId] === sUserId) {
          if (friendSocket) io.to(friendSocket).emit("presenceUpdate", { friendId: userId, inChat: true });
          socket.emit("presenceUpdate", { friendId, inChat: true });
        }
      });
    } 
    // 🔥 Group Presence Logic (Improved)
    else {
      // 1. Notify everyone in the group room that I am in the chat
      io.to(sFriendId).emit("groupPresence", { userId, inChat: true });

      // 2. Send the current "in chat" list to the joining user
      const currentInChat = {};
      Object.keys(activeChatRooms).forEach(uId => {
        if (activeChatRooms[uId] === sFriendId) {
          currentInChat[uId] = true;
        }
      });
      socket.emit("groupPresenceBulk", currentInChat);
    }
  });

  // 🔥 Real-time Logout Signal
  socket.on("forceLogoutDevice", ({ sessionId }) => {
    io.emit("sessionTerminated", { sessionId });
  });

  socket.on("leaveChat", ({ userId, friendId, isGroup }) => {
    const sUserId = String(userId);
    const sFriendId = String(friendId);
    delete activeChatRooms[sUserId];

    if (!isGroup) {
      const friendSocket = users[sFriendId];
      if (friendSocket) io.to(friendSocket).emit("presenceUpdate", { friendId: userId, inChat: false });
    } else {
      io.to(sFriendId).emit("groupPresence", { userId, inChat: false });
    }
  });

  // 🔥 Sync Mute Settings across tabs/components
  socket.on("muteSettingsUpdated", (data) => {
    io.emit("muteSettingsUpdated", data); // 📢 Use io.emit to sync all components
  });

  socket.on("registerUser", (userId) => {
    currentUserId = String(userId);
    users[currentUserId] = socket.id;
  io.emit("getOnlineUsers", Object.keys(users)); // 🔥 ADD THIS

    const now = new Date().toISOString();

    const updateSql = `UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?`;
    db.query(updateSql, [now, userId], () => {
      // ✅ Active status check
      db.query(
        "SELECT active_status FROM users WHERE id=?",
        [userId],
        (err, result) => {
          const isActive = result?.[0]?.active_status;

          if (isActive) {
            socket.broadcast.emit("userOnline", { userId: currentUserId });
            io.emit("getOnlineUsers", Object.keys(users));
          }
        },
      );

      // ✅ Send online users list
      socket.emit("getOnlineUsers", Object.keys(users));

      // ✅ Join group rooms for real-time signaling & status updates
      db.query(
        "SELECT group_id FROM group_members WHERE user_id = ?",
        [userId],
        (err, rows) => {
          if (!err && rows) {
            rows.forEach((row) => socket.join(String(row.group_id)));
            console.log(
              `User ${userId} joined group rooms:`,
              rows.map((r) => r.group_id),
            );
          }
        },
      );

      const deliverSql = `
UPDATE messages 
SET status = 'delivered' 
WHERE receiver_id = ? 
AND status = 'sent'
`;

      db.query(deliverSql, [userId], (err, result) => {
        if (!err && result.affectedRows > 0) {
          // 🔥 FIND ALL SENDERS
          db.query(
            "SELECT DISTINCT sender_id FROM messages WHERE receiver_id=?",
            [userId],
            (err2, rows) => {
              if (!err2) {
                rows.forEach((row) => {
                  const senderSocket = users[String(row.sender_id)];
                  if (senderSocket) {
                    io.to(senderSocket).emit("messageStatusUpdate", {
                      friendId: userId,
                      status: "delivered",
                      all: true,
                    });
                  }
                });
              }
            },
          );
        }
      });

      console.log("Online users:", users);
    });
  });

  // 🔥 Manually join a room (used when a new group is created)
  socket.on("joinRoom", (roomId) => {
    socket.join(String(roomId));
  });

  // 🔥 Relay friend request notification
  socket.on("friendRequestSent", ({ to, from }) => {
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      io.to(receiverSocket).emit("newFriendRequest", { from });
    }
  });

  // 🔥 Relay friend request accepted/rejected
  socket.on("friendRequestAccepted", ({ to, from }) => {
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      io.to(receiverSocket).emit("friendRequestAccepted", { from });
    }
  });

  socket.on("friendRequestRejected", ({ to, from }) => {
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      io.to(receiverSocket).emit("friendRequestRejected", { from });
    }
  });

  const getInitialStatus = async (receiverId, senderId, isGroup) => {
    if (isGroup) {
      // ग्रुप के लिए चेक करें कि क्या कोई मेंबर (भेजने वाले के अलावा) ऑनलाइन है
      const [members] = await db
        .promise()
        .query("SELECT user_id FROM group_members WHERE group_id = ?", [
          receiverId,
        ]);
      const onlineMember = members.find(
        (m) =>
          String(m.user_id) !== String(senderId) && users[String(m.user_id)],
      );

      if (onlineMember) return { status: "delivered", isViewed: 0 };
      return { status: "sent", isViewed: 0 };
    }

    const receiverSocket = users[String(receiverId)];
    if (!receiverSocket) return { status: "sent", isViewed: 0 };

    // Check receiver's read receipts preference
    const [rows] = await db
      .promise()
      .query("SELECT read_receipts FROM users WHERE id = ?", [receiverId]);
    const canSeeRead = rows?.[0]?.read_receipts;
    const inChat = activeChatRooms[String(receiverId)] === String(senderId);

    if (canSeeRead && inChat) return { status: "read", isViewed: 1 };
    if (inChat) return { status: "delivered", isViewed: 1 }; // Dono chat mein hain par privacy OFF hai
    return { status: "delivered", isViewed: 0 };
  };

  socket.on("getFriendStatus", ({ friendId }) => {
    const isOnline = users[String(friendId)];

    // 🔥 DB se active_status lao
    db.query(
      "SELECT active_status, last_seen FROM users WHERE id = ?",
      [friendId],
      (err, result) => {
        if (err || !result.length) return;

        const active_status = result[0].active_status;
        const lastSeen = result[0].last_seen;

        let status;

        if (isOnline && active_status) {
          status = "online";
        } else {
          status = "offline";
        }

        socket.emit("friendStatus", {
          userId: String(friendId),
          status,
          lastSeen:
            status === "offline" ? new Date(lastSeen).toISOString() : null,
        });
      },
    );
  });

  socket.on("sendMessage", async (data) => {
    const { sender, receiver, text, localId, replyTo, type, isGroup } = data;
    const isGroupBool = isGroup === true || isGroup === "true";

    // 🔥 FETCH ACTUAL DELETE MODE FROM DB (Don't trust client state)
    const u1 = isGroupBool ? 0 : Math.min(Number(sender), Number(receiver));
    const u2 = isGroupBool ? Number(receiver) : Math.max(Number(sender), Number(receiver));

    const [settings] = await db.promise().query(
          `
    SELECT delete_mode FROM chat_settings 
    WHERE (is_global = 1 AND user1=? AND user2=?)
    OR (is_global = 0 AND owner_id=? AND user1=? AND user2=?)
    ORDER BY is_global DESC, id DESC LIMIT 1
  `,
          [u1, u2, sender, u1, u2],
        );

    const deleteMode = settings.length ? settings[0].delete_mode : "never";

    const { status, isViewed } = await getInitialStatus(
      receiver,
      sender,
      isGroup,
    );

    // 🔥 delete logic
    let deleteAt = null;

    if (deleteMode === "24_hours") {
      deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          } else if (deleteMode === "after_view" && status === "read") {
      deleteAt = new Date(Date.now() + 60000);

    }

    const sql = `
  INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, local_id, reply_to, delete_mode, delete_at, is_viewed, is_group) 
  VALUES (
    ${db.escape(sender)}, 
    ${db.escape(receiver)}, 
    ${db.escape(text)}, 
    ${db.escape(status)}, 
    ${db.escape(type || "text")}, 
    ${db.escape(localId)},
    ${db.escape(replyTo)},
    ${db.escape(deleteMode || "never")},
    ${db.escape(deleteAt)},
    ${isViewed},
    ${isGroup ? 1 : 0}
  )
  `;

    try {
      const [result] = await db.promise().query(sql);
      const messageData = {
        ...data,
        id: result.insertId,
        replyTo: data.replyTo || null,
        status: status,
        deleteMode: deleteMode || "never",
        isGroup: !!isGroup, // 🔥 Fix: Added isGroup flag
      };

      if (isGroup) {
        // ✅ Broadcast to all members in the group room except sender
        socket.to(String(receiver)).emit("receiveMessage", messageData);
      } else {
        const receiverSocket = users[String(receiver)];
        if (receiverSocket) {
          io.to(receiverSocket).emit("receiveMessage", messageData);
        }
      }

      // 📤 send back to sender
      io.to(socket.id).emit("messageSent", {
        localId,
        status,
        id: result.insertId,
        replyTo: data.replyTo || null,
      });

      // 🔥 Auto-delete timer if sent to active chat
      if (deleteMode === "after_view" && status === "read") {
        setTimeout(async () => {
          await db.promise().query("DELETE FROM messages WHERE id = ?", [result.insertId]);
          io.emit("messageDeleted", { messageId: result.insertId });
        }, 60000);
      }
    } catch (err) {
      console.error("Message save error:", err);
      io.to(socket.id).emit("messageSent", { localId, status: "error" });
    }
  });

  socket.on("messageOpened", async ({ messageId }) => {
    const [rows] = await db
      .promise()
      .query(
        "SELECT delete_mode, delete_at, sender_id, receiver_id, is_group, status FROM messages WHERE id = ?",
        [messageId],
      );

    if (!rows.length) return;
    const { delete_mode, delete_at, sender_id, receiver_id, is_group, status } =
      rows[0];

    // ✅ Mark as READ and notify room/sender
    if (status !== "read") {
      await db
        .promise()
        .query("UPDATE messages SET status='read', is_viewed=1 WHERE id=?", [
          messageId,
        ]);

      const updateData = {
        id: messageId,
        status: "read",
        friendId: is_group ? receiver_id : sender_id,
      };

      if (is_group) {
        io.to(String(receiver_id)).emit("messageStatusUpdate", updateData);
      } else {
        const senderSocket = users[String(sender_id)];
        if (senderSocket)
          io.to(senderSocket).emit("messageStatusUpdate", updateData);
      }
    }

    if (delete_mode === "after_view" && !delete_at) {
      // 🔥 1 minute baad delete karne ke liye DB mein timestamp update karein
      await db
        .promise()
        .query(
          "UPDATE messages SET delete_at = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id = ?",
          [messageId],
        );

      // 🔥 1 minute (60000ms) ka delay timer
      setTimeout(async () => {
        await db
          .promise()
          .query("DELETE FROM messages WHERE id = ?", [messageId]);
        io.emit("messageDeleted", { messageId });
      }, 60000);
    }
  });

  socket.on("send_voice", async (data) => {
    const { senderId, receiverId, audioUrl, duration, localId, time, isGroup } =
      data;
    const isGroupBool = isGroup === true || isGroup === "true";

    // 🔥 FETCH ACTUAL DELETE MODE FROM DB
    const u1 = isGroupBool ? 0 : Math.min(Number(senderId), Number(receiverId));
    const u2 = isGroupBool ? Number(receiverId) : Math.max(Number(senderId), Number(receiverId));

    const [settings] = await db.promise().query(
          `
    SELECT delete_mode FROM chat_settings 
    WHERE (is_global = 1 AND user1=? AND user2=?)
    OR (is_global = 0 AND owner_id=? AND user1=? AND user2=?)
    ORDER BY is_global DESC, id DESC LIMIT 1
  `,
          [u1, u2, senderId, u1, u2],
        );

    const deleteMode = settings.length ? settings[0].delete_mode : "never";

    const { status, isViewed } = await getInitialStatus(
      receiverId,
      senderId,
      isGroup,
    );

    // 🔥 delete logic
    let deleteAt = null;
    if (deleteMode === "24_hours") {
      deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else if (deleteMode === "after_view" && status === "read") {
      deleteAt = new Date(Date.now() + 60000); // 1 minute
    }

    const sql = `
  INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, duration, local_id, delete_mode, delete_at, is_viewed, is_group) 
  VALUES (
    ${db.escape(senderId)}, 
    ${db.escape(receiverId)}, 
    ${db.escape(audioUrl)}, 
    ${db.escape(status)}, 
    'voice', 
    ${db.escape(duration || 0)},
    ${db.escape(localId)},
    ${db.escape(deleteMode || "never")},
    ${db.escape(deleteAt)},
    ${isViewed},
    ${isGroup ? 1 : 0}
  )`;

    try {
      const [result] = await db.promise().query(sql);

      const msgData = {
        id: result.insertId,
        localId,
        sender: senderId,
        receiver: receiverId,
        message: audioUrl,
        type: "voice",
        duration,
        status: status,
        deleteMode: deleteMode || "never",
        time:
          time ||
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        isGroup: !!isGroup, // 🔥 Fix: Added isGroup flag
      };

      if (isGroup) {
        // ✅ Use room broadcast for better reliability
        socket.to(String(receiverId)).emit("receiveMessage", msgData);
      } else {
        const receiverSocket = users[String(receiverId)];
        if (receiverSocket) {
          io.to(receiverSocket).emit("receiveMessage", msgData);
        }
      }

      io.to(socket.id).emit("messageSent", msgData);

      // 🔥 Auto-delete timer if sent to active chat
      if (deleteMode === "after_view" && status === "read") {
        setTimeout(async () => {
          await db.promise().query("DELETE FROM messages WHERE id = ?", [result.insertId]);
          io.emit("messageDeleted", { messageId: result.insertId });
        }, 60000);
      }
    } catch (err) {
      console.error("❌ Voice save error:", err);
    }
  });

  // ❤️ REACTION SYSTEM
  socket.on("sendReaction", async (data) => {
    const { messageId, userId, emoji, toUserId, isGroup } = data;

    if (!messageId) {
      console.log("❌ messageId missing");
      return;
    }

    try {
      let [rows] = await db
        .promise()
        .query("SELECT reactions FROM messages WHERE id = ?", [messageId]);

      let reactions = rows[0]?.reactions;

      // ✅ SAFE PARSE (IMPORTANT)
      if (typeof reactions === "string") {
        reactions = JSON.parse(reactions);
      }

      reactions = reactions || {};

      // ✅ add/update reaction
      reactions[userId] = emoji;

      await db
        .promise()
        .query("UPDATE messages SET reactions = ? WHERE id = ?", [
          JSON.stringify(reactions),
          messageId,
        ]);

      const payload = { messageId, reactions };

      if (isGroup) {
        // ✅ Group broadcast
        io.to(String(toUserId)).emit("reactionUpdated", payload);
      } else {
        // ✅ 1-to-1 logic
        socket.emit("reactionUpdated", payload);
        const receiverSocket = users[String(toUserId)];
        if (receiverSocket) {
          io.to(receiverSocket).emit("reactionUpdated", payload);
        }
      }
    } catch (err) {
      console.error("Reaction error:", err);
    }
  });
  socket.on("messageRead", (data) => {
    const { sender, id } = data;
    if (!id) return;

    db.query(
      "SELECT delete_mode, delete_at, sender_id, receiver_id, is_group FROM messages WHERE id = ?",
      [id],
      (err, msgRows) => {
        if (err || !msgRows.length) return;
        const { delete_mode, delete_at, sender_id, receiver_id, is_group } =
          msgRows[0];

        // 🔥 1. TIMER START
        if (delete_mode === "after_view" && !delete_at) {
          db.query(
            "UPDATE messages SET delete_at = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id=?",
            [id],
          );
          setTimeout(() => {
            db.query("DELETE FROM messages WHERE id = ?", [id], () =>
              io.emit("messageDeleted", { messageId: id }),
            );
          }, 60000);
        }

        // 🔥 2. BLUE TICK LOGIC
        db.query(
          "SELECT read_receipts FROM users WHERE id=?",
          [currentUserId],
          (err, result) => {
            if (!err && result?.[0]?.read_receipts) {
              // Status tabhi badlein agar message pehle kabhi nahi dekha gaya (is_viewed=0)
              db.query(
                "UPDATE messages SET status='read', is_viewed=1 WHERE id=? AND status='delivered' AND is_viewed=0",
                [id],
                (err2, res2) => {
                  if (res2.affectedRows > 0) {
                    const updatePayload = {
                      id,
                      status: "read",
                      friendId: is_group ? receiver_id : sender_id,
                    };
                    if (is_group) {
                      io.to(String(receiver_id)).emit(
                        "messageStatusUpdate",
                        updatePayload,
                      );
                    } else {
                      const senderSocket = users[String(sender_id)];
                      if (senderSocket)
                        io.to(senderSocket).emit(
                          "messageStatusUpdate",
                          updatePayload,
                        );
                    }
                  }
                },
              );
            } else {
              // Privacy OFF hai, toh sirf viewed mark karein taaki baad mein blue tick na ho
              db.query("UPDATE messages SET is_viewed = 1 WHERE id = ?", [id]);
            }
          },
        );
      },
    );
  });

  socket.on("markAllAsRead", ({ senderId, receiverId, isGroup }) => {
    const isGroupBool = isGroup === true || isGroup === "true";

    // 1. Timer start karein
    const timerSql = isGroupBool 
      ? "SELECT id FROM messages WHERE receiver_id=? AND is_group=1 AND delete_mode='after_view' AND delete_at IS NULL AND sender_id != ?" 
      : "SELECT id FROM messages WHERE sender_id=? AND receiver_id=? AND delete_mode='after_view' AND delete_at IS NULL";
    
    const timerParams = isGroupBool ? [receiverId, senderId] : [senderId, receiverId];

    db.query(timerSql, timerParams,
      (err, rows) => {
        if (!err) {
          rows.forEach((row) => {
            db.query(
              "UPDATE messages SET delete_at = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id=?",
              [row.id],
            );
            setTimeout(() => {
              db.query("DELETE FROM messages WHERE id = ?", [row.id], () =>
                isGroupBool 
                  ? io.to(String(receiverId)).emit("messageDeleted", { messageId: row.id })
                  : io.emit("messageDeleted", { messageId: row.id }) // 1-to-1 global emit for multi-device sync
              );
            }, 60000);
          });
        }
      },
    );

    if (isGroupBool) {
      // ग्रुप के लिए सभी को 'read' मार्क करें (Snapchat की तरह)
      db.query(
        "UPDATE messages SET status='read', is_viewed=1 WHERE receiver_id=? AND is_group=1 AND status='delivered' AND sender_id != ?",
        [receiverId, senderId],
        (err) => {
          if (!err)
            io.to(String(receiverId)).emit("messageStatusUpdate", {
              friendId: receiverId,
              status: "read",
              all: true,
            });
        },
      );
      return;
    }

    // 2. Status update logic (Respects Privacy & Silent Views)
    db.query(
      "SELECT read_receipts FROM users WHERE id=?",
      [receiverId],
      (err, res) => {
        if (!err && res?.[0]?.read_receipts) {
          // Pehle wo IDs nikalein jo sach mein 'read' honi chahiye (is_viewed = 0)
          const findSql =
            "SELECT id FROM messages WHERE sender_id=? AND receiver_id=? AND status='delivered' AND is_viewed=0";
          db.query(findSql, [senderId, receiverId], (errF, rows) => {
            if (!errF && rows.length > 0) {
              const ids = rows.map((r) => r.id);
              const updateSql =
                "UPDATE messages SET status='read', is_viewed=1 WHERE id IN (?)";
              db.query(updateSql, [ids], (errU) => {
                if (!errU) {
                  const senderSocket = users[String(senderId)];
                  if (senderSocket) {
                    io.to(senderSocket).emit("messageStatusUpdate", {
                      friendId: receiverId,
                      status: "read",
                      messageIds: ids, // 🔥 IDs bhejein na ki 'all: true'
                    });
                  }
                }
              });
            }
          });
          // Mark everything else as viewed silently
          db.query(
            "UPDATE messages SET is_viewed=1 WHERE sender_id=? AND receiver_id=? AND status='delivered'",
            [senderId, receiverId],
          );
        } else {
          // Privacy OFF hai, sabko viewed mark kar do (silently)
          db.query(
            "UPDATE messages SET is_viewed=1 WHERE sender_id=? AND receiver_id=? AND status='delivered'",
            [senderId, receiverId],
          );
        }
      },
    );
  });

  socket.on("typing", (data) => {
    if (data.isGroup) {
      db.query(
        "SELECT user_id FROM group_members WHERE group_id = ?",
        [data.receiver],
        (err, rows) => {
          if (err) return;
          rows.forEach((row) => {
            if (String(row.user_id) !== String(data.sender)) {
              const s = users[String(row.user_id)];
              if (s) io.to(s).emit("typing", data);
            }
          });
        },
      );
    } else {
      const receiverSocket = users[String(data.receiver)];
      if (receiverSocket) {
        io.to(receiverSocket).emit("typing", data);
      }
    }
  });
  socket.on("stopTyping", (data) => {
    if (data.isGroup) {
      db.query(
        "SELECT user_id FROM group_members WHERE group_id = ?",
        [data.receiver],
        (err, rows) => {
          if (err) return;
          rows.forEach((row) => {
            if (String(row.user_id) !== String(data.sender)) {
              const s = users[String(row.user_id)];
              if (s) io.to(s).emit("stopTyping", data);
            }
          });
        },
      );
    } else {
      const receiverSocket = users[String(data.receiver)];
      if (receiverSocket) {
        io.to(receiverSocket).emit("stopTyping", data);
      }
    }
  });
  socket.on("recording", (data) => {
    if (data.isGroup) {
      db.query(
        "SELECT user_id FROM group_members WHERE group_id = ?",
        [data.receiver],
        (err, rows) => {
          if (err) return;
          rows.forEach((row) => {
            if (String(row.user_id) !== String(data.sender)) {
              const s = users[String(row.user_id)];
              if (s) io.to(s).emit("recording", data);
            }
          });
        },
      );
    } else {
      const receiverSocket = users[String(data.receiver)];
      if (receiverSocket) io.to(receiverSocket).emit("recording", data);
    }
  });
  socket.on("stopRecording", (data) => {
    if (data.isGroup) {
      db.query(
        "SELECT user_id FROM group_members WHERE group_id = ?",
        [data.receiver],
        (err, rows) => {
          if (err) return;
          rows.forEach((row) => {
            if (String(row.user_id) !== String(data.sender)) {
              const s = users[String(row.user_id)];
              if (s) io.to(s).emit("stopRecording", data);
            }
          });
        },
      );
    } else {
      const receiverSocket = users[String(data.receiver)];
      if (receiverSocket) io.to(receiverSocket).emit("stopRecording", data);
    }
  });
  socket.on("disconnect", () => {
    if (currentUserId) {
      // Clean up chat presence on disconnect
      const myFriendId = activeChatRooms[currentUserId];
      if (myFriendId) {
        const fSock = users[myFriendId];
        if (fSock)
          io.to(fSock).emit("presenceUpdate", {
            friendId: currentUserId,
            inChat: false,
          });
      }
      delete activeChatRooms[currentUserId];

      // 🔥 REMOVE FROM CALL LIST
      inCallUsers.delete(String(currentUserId));

      // 🔥 Group Chat Presence Cleanup on Disconnect
      if (myFriendId) {
        io.to(String(myFriendId)).emit("groupPresence", { userId: currentUserId, inChat: false });
      }

      delete users[currentUserId];

      const now = new Date().toISOString();
      const updateSql = `UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?`;
      db.query(updateSql, [now, currentUserId], () => {
        io.emit("userOffline", { userId: currentUserId, lastSeen: now });
        io.emit("getOnlineUsers", Object.keys(users));
      });
    }
  });

  socket.on("callUser", async ({ to, from, name, callType, isGroup }) => {
    console.log("Call request:", from, "→", to);
    console.log("Socket ID mapping:", to, "->", users[String(to)]);

    // 🔥 CALL START LOG (YAHI ADD KARNA HAI)
    const typeValue = callType === "video" ? "video_call" : "voice_call";

    const startMsg = `📞 ${callType === "video" ? "Video" : "Voice"} Call Started`;

    const sql = `INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, duration, is_group) 
  VALUES (
    ${db.escape(from)}, 
    ${db.escape(to)}, 
    ${db.escape(startMsg)}, 
    'sent', 
    ${db.escape(typeValue)},
    0,
    ${isGroup ? 1 : 0}
  )`;

    db.query(sql, (err) => {
      if (err) {
        console.error("❌ Call start save error:", err);
      }
    });

    if (isGroup) {
      const [members] = await db
        .promise()
        .query("SELECT user_id FROM group_members WHERE group_id = ?", [to]);
      members.forEach((member) => {
        if (String(member.user_id) !== String(from)) {
          const s = users[String(member.user_id)];
          if (s)
            io.to(s).emit("incomingCall", {
              from,
              name,
              callType,
              isGroup: true,
              groupId: to,
            });
        }
      });
      return;
    }

    // ❌ receiver busy
    if (inCallUsers.has(String(to))) {
      return io.to(users[String(from)]).emit("userBusy");
    }

    // ❌ caller busy
    if (inCallUsers.has(String(from))) {
      return;
    }

    // ✅ mark caller busy
    inCallUsers.add(String(from));

    const receiverSocket = users[String(to)];

    if (receiverSocket) {
      io.to(receiverSocket).emit("incomingCall", {
        from,
        name,
        callType,
      });
    }
  });

  socket.on("endCall", ({ from, to, duration = 0, callType, isGroup }) => {
    console.log("Call ended:", from, "↔", to);

    inCallUsers.delete(String(from));
    inCallUsers.delete(String(to));

    const senderSocket = users[String(from)];
    const receiverSocket = users[String(to)];

    // 🔥 FORMAT
    const icon = callType === "video" ? "📹" : "📞";
    const typeText = callType === "video" ? "Video" : "Voice";

    let callLogMsg = `${icon} ${typeText} Call Ended`;

    if (duration !== undefined) {
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const timeString = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
      callLogMsg = `${icon} ${typeText} call ended • ${timeString}`;
    }

    // ✅ TYPE
    const typeValue = callType === "video" ? "video_call" : "voice_call";

    // ✅ SAVE IN DB
    const sql = `INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, duration, is_group) 
  VALUES (
    ${db.escape(from)}, 
    ${db.escape(to)}, 
    ${db.escape(callLogMsg)}, 
    'read', 
    ${db.escape(typeValue)},
    ${db.escape(duration || 0)},
    ${isGroup ? 1 : 0}
  )`;

    db.query(sql, (err) => {
      if (err) {
        console.error("❌ DB Error saving call log:", err.sqlMessage || err);
      } else {
        console.log("✅ Call END saved in DB");
      }

      const msgData = {
        localId: `sys_${Date.now()}_${from}_${to}`,
        sender: from,
        receiver: to,
        text: callLogMsg,
        type: typeValue,
        duration: duration || 0,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: "read",
        isGroup: !!isGroup,
      };

      if (isGroup) {
        socket.to(String(to)).emit("receiveMessage", msgData);
        socket.to(String(to)).emit("callEnded", msgData);
      } else {
        if (receiverSocket) {
          io.to(receiverSocket).emit("receiveMessage", msgData);
          io.to(receiverSocket).emit("callEnded", msgData);
        }
      }

      if (senderSocket) {
        io.to(senderSocket).emit("callEnded");
      }
    });
  });
  socket.on("answerCall", ({ to, from }) => {
    console.log("Call accepted:", from, "↔", to);

    // ✅ dono busy
    inCallUsers.add(String(from));
    inCallUsers.add(String(to));

    const receiverSocket = users[String(to)];

    if (receiverSocket) {
      io.to(receiverSocket).emit("callAccepted", { from }); // Joiner ki ID initiator ko bhejo
    }
  });
  socket.on("rejectCall", ({ to, from, callType, isGroup, groupId }) => {
    console.log("Call rejected:", from, "→", to);

    inCallUsers.delete(String(from));
    inCallUsers.delete(String(to));

    const receiverSocket = users[String(to)];

    // 🔥 FORMAT
    const icon = callType === "video" ? "📹" : "📞";
    const typeText = callType === "video" ? "Video" : "Voice";
    const dbMsg = `❌ ${icon} ${typeText} Missed Call`;

    // ✅ FIX TYPE
    const typeValue = callType === "video" ? "video_call" : "voice_call";

    // ✅ Group call reject log should target GroupID, not person
    const receiverId = isGroup ? groupId : from;
    const senderId = to; // Person who called

    const sql = `INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, duration, is_group) 
  VALUES (
    ${db.escape(senderId)}, 
    ${db.escape(receiverId)}, 
    ${db.escape(dbMsg)}, 
    'read', 
    ${db.escape(typeValue)},
    0,
    ${isGroup ? 1 : 0}
  )`;

    db.query(sql, (err) => {
      if (err) {
        console.error("❌ DB Error saving reject log:", err.sqlMessage || err);
      }

      if (receiverSocket) {
        io.to(receiverSocket).emit("callRejected");
      }
    });
  });

  socket.on("offer", (data) => {
    const { to, from, offer, isGroup } = data;
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      // Targeted signaling (Dono 1-to-1 aur Group joiners ke liye)
      io.to(receiverSocket).emit("offer", { offer, from, isGroup: !!isGroup, groupId: isGroup ? to : null });
    } else if (isGroup) {
      // Fallback: Agar specific ID nahi hai toh room broadcast karein
      socket.to(String(to)).emit("offer", { offer, from, isGroup: true, groupId: to });
    }

  });

  socket.on("answer", (data) => {
    const { to, from, answer } = data;
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      io.to(receiverSocket).emit("answer", { answer, from });
    }
  });

  socket.on("ice-candidate", (data) => {
    const { to, from, candidate, isGroup } = data;
    const receiverSocket = users[String(to)];
    if (receiverSocket) {
      io.to(receiverSocket).emit("ice-candidate", { candidate, from, isGroup: !!isGroup, groupId: isGroup ? to : null });
    } else if (isGroup) {
      // Fallback: Room broadcast
      socket.to(String(to)).emit("ice-candidate", { candidate, from, isGroup: true, groupId: to });
    }

  });

  socket.on("deleteMessage", async ({ messageId, sender, receiver, isGroup }) => {
    if (!messageId) return;

    try {
      // ✅ DB se delete
      await db
        .promise()
        .query("DELETE FROM messages WHERE id = ?", [messageId]);

      if (isGroup) {
        // ✅ Group broadcast
        io.to(String(receiver)).emit("messageDeleted", { messageId });
      } else {
        // ✅ 1-to-1 logic
        socket.emit("messageDeleted", { messageId });

        const receiverSocket = users[String(receiver)];
        if (receiverSocket) {
          io.to(receiverSocket).emit("messageDeleted", { messageId });
        }
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  });

  socket.on("deleteForMe", async ({ messageId, userId }) => {
    if (!messageId || !userId) return;

    try {
      await db
        .promise()
        .query(
          "INSERT INTO deleted_messages (user_id, message_id) VALUES (?, ?)",
          [userId, messageId],
        );

      socket.emit("messageDeletedForMe", { messageId });
    } catch (err) {
      console.error("Delete for me error:", err);
    }
  });
  socket.on(
    "editMessageEveryone",
    async ({ messageId, newText, sender, receiver, isGroup }) => {
      if (!messageId) return;

      try {
        await db
          .promise()
          .query(
            "UPDATE messages SET message = ?, is_edited = 1 WHERE id = ?",
            [newText, messageId],
          );

        const data = { messageId, newText, isEdited: true };

        if (isGroup) {
          // ✅ Group broadcast
          io.to(String(receiver)).emit("messageEdited", data);
        } else {
          // ✅ 1-to-1 logic
          socket.emit("messageEdited", data);

          const receiverSocket = users[String(receiver)];
          if (receiverSocket) {
            io.to(receiverSocket).emit("messageEdited", data);
          }
        }
      } catch (err) {
        console.error("Edit error:", err);
      }
    },
  );

  socket.on("editMessageForMe", async ({ messageId, userId, newText }) => {
    if (!messageId || !userId) return;

    try {
      await db.promise().query(
        `INSERT INTO edited_messages (user_id, message_id, edited_text) 
   VALUES (?, ?, ?)
   ON DUPLICATE KEY UPDATE edited_text = ?`,
        [userId, messageId, newText, newText],
      );

      socket.emit("messageEditedForMe", { messageId, newText });
    } catch (err) {
      console.error("Edit for me error:", err);
    }
  });

  socket.on("send_media", async (data) => {
    const {
      senderId,
      receiverId,
      mediaUrl,
      mediaType,
      localId,
      time,
      duration,
      isGroup,
    } = data;
    const isGroupBool = isGroup === true || isGroup === "true";

    // 🔥 FETCH ACTUAL DELETE MODE FROM DB
    const u1 = isGroupBool ? 0 : Math.min(Number(senderId), Number(receiverId));
    const u2 = isGroupBool ? Number(receiverId) : Math.max(Number(senderId), Number(receiverId));

    const [settings] = await db.promise().query(
          `
    SELECT delete_mode FROM chat_settings 
    WHERE (is_global = 1 AND user1=? AND user2=?)
    OR (is_global = 0 AND owner_id=? AND user1=? AND user2=?)
    ORDER BY is_global DESC, id DESC LIMIT 1
  `,
          [u1, u2, senderId, u1, u2],
        );

    const deleteMode = settings.length ? settings[0].delete_mode : "never";

    const { status, isViewed } = await getInitialStatus(
      receiverId,
      senderId,
      isGroup,
    );

    // 🔥 delete logic
    let deleteAt = null;
    if (deleteMode === "24_hours") {
      deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else if (deleteMode === "after_view" && status === "read") {
      deleteAt = new Date(Date.now() + 60000);
    }

    const sql = `
  INSERT INTO messages 
  (sender_id, receiver_id, message, status, type, local_id, duration, delete_mode, delete_at, is_viewed, is_group) 
  VALUES (
    ${db.escape(senderId)}, 
    ${db.escape(receiverId)}, 
    ${db.escape(mediaUrl)}, 
    ${db.escape(status)}, 
    ${db.escape(mediaType)},
    ${db.escape(localId)},
    ${db.escape(duration || 0)},
    ${db.escape(deleteMode || "never")},
    ${db.escape(deleteAt)},
    ${isViewed},
    ${isGroup ? 1 : 0}
  )`;

    try {
      const [result] = await db.promise().query(sql);

      const msgData = {
        id: result.insertId,
        localId,
        sender: senderId,
        receiver: receiverId,
        message: mediaUrl,
        type: mediaType,
        duration: duration || 0,
        status: status,
        deleteMode: deleteMode || "never",
        time:
          time ||
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        isGroup: !!isGroup, // 🔥 Fix: Added isGroup flag
      };

      if (isGroup) {
        // ✅ Use room broadcast for better reliability
        socket.to(String(receiverId)).emit("receiveMessage", msgData);
      } else {
        const receiverSocket = users[String(receiverId)];
        if (receiverSocket) {
          io.to(receiverSocket).emit("receiveMessage", msgData);
        }
      }

      io.to(socket.id).emit("messageSent", msgData);

      // 🔥 Auto-delete timer if sent to active chat
      if (deleteMode === "after_view" && status === "read") {
        setTimeout(async () => {
          await db.promise().query("DELETE FROM messages WHERE id = ?", [result.insertId]);
          io.emit("messageDeleted", { messageId: result.insertId });
        }, 60000);
      }
    } catch (err) {
      console.error("❌ Media save error:", err);
    }
  });

  // 🔥 GROUP JOIN
  socket.on("joinGroup", (groupId) => {
    socket.join(String(groupId));
    console.log("Joined group:", groupId);
  });

  socket.on("toggle-camera", (data) => {
    const { to, isOff, isGroup } = data;
    if (isGroup) {
      socket.to(String(to)).emit("toggle-camera", { isOff });
    } else {
      const receiverSocket = users[String(to)];
      if (receiverSocket) io.to(receiverSocket).emit("toggle-camera", { isOff });
    }
  });

});

// 🔥 Global Error Handling Middleware
// This catches Multer errors (like file size or invalid type) and returns 400 instead of 500
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Handle Multer-specific errors (e.g., file too large, unexpected field name)
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    // Handle other errors (like the one thrown in fileFilter)
    console.error("Server Error:", err.message);
    return res
      .status(err.status || 500)
      .json({ error: err.message || "Internal Server Error" });
  }
  next();
});

//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
//dfghjklkjhgfghjklkjhgfghjklkjhg
