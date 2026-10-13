import { useState, useEffect } from 'react';
import { listWaitlist, removeWaitlist } from '../../server/admin/adminWaitlist';

export default function AdminWaitlistPage() {
  const [list, setList] = useState<{ id: string; email: string; createdAt: Date }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listWaitlist().then((data) => {
      setList(data);
      setLoading(false);
    });
  }, []);

  const handleRemove = async (id: string) => {
    await removeWaitlist(id);
    setList((prev) => prev.filter((e) => e.id !== id));
  };

  if (loading) return <p>Loading…</p>;

  return (
    <section className="mk-section">
      <div className="mk-container">
        <h2>Wait‑list subscribers</h2>
        {list.length === 0 ? (
          <p>No one has signed up yet.</p>
        ) : (
          <ul className="mk-table">
            {list.map(({ id, email, createdAt }) => (
              <li key={id} className="mk-table__row">
                <span className="mk-table__cell">{email}</span>
                <span className="mk-table__cell">{new Date(createdAt).toLocaleDateString()}</span>
                <button
                  className="mk-button mk-button--danger mk-button--small"
                  onClick={() => handleRemove(id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}