import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async () => {
    if (!email) {
      showToast("Please enter your email! 📧");
      return;
    }

    try {

      const res = await axios.post(
        "https://snapchatclone.onrender.com/api/auth/forgot-password",
        { email }
      );

      showToast(res.data.message || "Reset link sent! ✅");

    } catch (err) {

      console.log(err);
      showToast("Error sending reset link ❌");

    }

  };

  return (
    <div style={styles.container}>
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

      <div style={styles.card}>
        <h2>Forgot Password</h2>

        <input
          type="email"
          placeholder="Enter your email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button style={styles.button} onClick={handleSubmit}>
          Send Reset Link
        </button>

        <p>
          <Link to="/">Back to Login</Link>
        </p>
      </div>
    </div>
  );
};

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#000",
    color: "#fff",
  },
  card: {
    width: "360px",
    padding: "30px",
    background: "#121212",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "15px",
  },
  input: {
    padding: "12px",
    borderRadius: "6px",
    border: "none",
  },
  button: {
    padding: "12px",
    background: "#fffc00",
    border: "none",
    borderRadius: "6px",
    fontWeight: "bold",
    cursor: "pointer",
  },
};

export default ForgotPassword;