import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

export default function RolesPermissions() {
  const navigate = useNavigate();
  const user = authService.getSession();

  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "student",
  });

  if (!user || user.role !== "admin") {
    navigate("/login");
    return null;
  }

  const loadUsers = async () => {
    const res = await fetch("http://localhost:3000/users");
    const data = await res.json();
    setUsers(data);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const saveUser = async () => {
    if (!form.full_name || !form.email) {
      alert("Complete all fields.");
      return;
    }

    if (editingId === null) {
      await fetch("http://localhost:3000/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
    } else {
      await fetch(`http://localhost:3000/users/${editingId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
    }

    setShowModal(false);
    setEditingId(null);

    setForm({
      full_name: "",
      email: "",
      role: "student",
    });

    loadUsers();
  };

  const deleteUser = async (id: number) => {
    if (!window.confirm("Delete this user?")) return;

    await fetch(`http://localhost:3000/users/${id}`, {
      method: "DELETE",
    });

    loadUsers();
  };

  const editUser = (user: any) => {
    setEditingId(user.id);

    setForm({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    });

    setShowModal(true);
  };

  const filtered = users.filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div style={{ padding: 30 }}>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <h1>Roles & Permissions</h1>

            <input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                marginTop: 10,
                padding: 10,
                width: 300,
              }}
            />
          </div>

          <button
            onClick={() => {
              setEditingId(null);

              setForm({
                full_name: "",
                email: "",
                role: "student",
              });

              setShowModal(true);
            }}
            style={{
              background: "#32cd32",
              color: "#fff",
              border: "none",
              padding: "12px 22px",
              borderRadius: 8,
              cursor: "pointer",
              height: 45,
            }}
          >
            + Add User
          </button>
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
          }}
        >
          <thead>
            <tr style={{ background: "#f2f2f2" }}>
              <th style={{ padding: 15 }}>Full Name</th>
              <th>Email</th>
              <th>Role</th>
              <th width="200">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid #ddd" }}>
                <td style={{ padding: 15 }}>{u.full_name}</td>

                <td>{u.email}</td>

                <td>
                  <span
                    style={{
                      background: "#dff5e5",
                      padding: "6px 12px",
                      borderRadius: 20,
                    }}
                  >
                    {u.role}
                  </span>
                </td>

                <td>
                  <button
                    onClick={() => editUser(u)}
                    style={{
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      padding: "8px 15px",
                      borderRadius: 6,
                      marginRight: 10,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => deleteUser(u.id)}
                    style={{
                      background: "#d32f2f",
                      color: "white",
                      border: "none",
                      padding: "8px 15px",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
                {showModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,.45)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <div
              style={{
                background: "#fff",
                width: 450,
                borderRadius: 10,
                padding: 25,
              }}
            >
              <h2 style={{ marginBottom: 20 }}>
                {editingId === null ? "Add User" : "Edit User"}
              </h2>

              <div style={{ marginBottom: 15 }}>
                <label>Full Name</label>

                <input
                  value={form.full_name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      full_name: e.target.value,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    marginTop: 5,
                  }}
                />
              </div>

              <div style={{ marginBottom: 15 }}>
                <label>Email</label>

                <input
                  value={form.email}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      email: e.target.value,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    marginTop: 5,
                  }}
                />
              </div>

              <div style={{ marginBottom: 25 }}>
                <label>Role</label>

                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: 10,
                    marginTop: 5,
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="student">Student</option>
                  <option value="faculty">Faculty</option>
                  <option value="registrar">Registrar</option>
                  <option value="program head">Program Head</option>
                </select>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                }}
              >
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: "10px 18px",
                    border: "1px solid #ccc",
                    background: "#fff",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={saveUser}
                  style={{
                    padding: "10px 18px",
                    background: "#32cd32",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}