import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";

const Register = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleRegister = async () => {
    if (!username || !email || !password) {
      showToast("Please fill all fields! 📝");
      return;
    }

    try {

      const res = await axios.post(
        "http://localhost:5000/api/auth/register",
        {
          username,
          email,
          password
        }
      );

      showToast("Registration successful! 🎉");

      setTimeout(() => navigate("/"), 2000);

    } catch (err) {

      showToast(err.response?.data?.message || "Registration failed ❌");

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
        <h2>Create Account</h2>

        <input
          type="text"
          placeholder="Username"
          style={styles.input}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          type="email"
          placeholder="Email"
          style={styles.input}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          style={styles.input}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button style={styles.button} onClick={handleRegister}>
          Register
        </button>

        <p>
          Already have account? <Link to="/">Login</Link>
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
  },
};

export default Register;