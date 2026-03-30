import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bot, Users } from "lucide-react";
import api from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useToastStore } from "../../stores/toastStore";

export default function NewConversation() {
  const queryClient = useQueryClient();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [form, setForm] = useState({
    age: "",
    gender: "prefer_not_to_say",
    heightCm: "",
    weightKg: "",
    chronicConditions: "",
    symptomDurationValue: "",
    symptomDurationUnit: "days",
    painScale: "",
    mainComplaint: "",
  });

  const pushToast = useToastStore((s) => s.pushToast);
  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await api.post("/api/conversations", payload);
      return res.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConversation(data._id);
      setCreating(false);
      setSelectedChannel(null);
      pushToast("success", "Conversation created successfully.");
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message ||
        "Failed to create conversation. Please try again.";
      setError(message);
      pushToast("error", message);
      setCreating(false);
    },
  });

  const validateForm = (): string | null => {
    const age = Number(form.age);
    const symptomDurationValue = Number(form.symptomDurationValue);
    const painScale = Number(form.painScale);
    const height = form.heightCm ? Number(form.heightCm) : undefined;
    const weight = form.weightKg ? Number(form.weightKg) : undefined;

    if (!selectedChannel) return "Please select a conversation channel.";
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      return "Age must be an integer between 1 and 120.";
    }
    if (
      !Number.isInteger(symptomDurationValue) ||
      symptomDurationValue < 1 ||
      symptomDurationValue > 3650
    ) {
      return "Symptom duration must be between 1 and 3650.";
    }
    if (!Number.isInteger(painScale) || painScale < 0 || painScale > 10) {
      return "Pain scale must be an integer between 0 and 10.";
    }
    if (form.mainComplaint.trim().length < 10) {
      return "Main complaint must be at least 10 characters.";
    }
    if (form.mainComplaint.trim().length > 1000) {
      return "Main complaint must be at most 1000 characters.";
    }
    if (
      height !== undefined &&
      (Number.isNaN(height) || height < 50 || height > 250)
    ) {
      return "Height must be between 50 and 250 cm.";
    }
    if (
      weight !== undefined &&
      (Number.isNaN(weight) || weight < 2 || weight > 300)
    ) {
      return "Weight must be between 2 and 300 kg.";
    }

    return null;
  };

  const handleCreate = () => {
    setError("");
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setCreating(true);

    const chronicConditions = form.chronicConditions
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 20);

    createMutation.mutate({
      channel: selectedChannel,
      intake: {
        version: 1,
        demographics: {
          age: Number(form.age),
          gender: form.gender,
        },
        vitals: {
          ...(form.heightCm ? { heightCm: Number(form.heightCm) } : {}),
          ...(form.weightKg ? { weightKg: Number(form.weightKg) } : {}),
        },
        clinical: {
          chronicConditions,
          symptomDuration: {
            value: Number(form.symptomDurationValue),
            unit: form.symptomDurationUnit,
          },
          painScale: Number(form.painScale),
          mainComplaint: form.mainComplaint.trim(),
        },
      },
    });
  };

  const resetStep = () => {
    setSelectedChannel(null);
    setError("");
  };

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="new-conv-panel">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ textAlign: "center" }}
      >
        <h2>Start a New Conversation</h2>
        <p>
          {selectedChannel
            ? "Complete intake details before chat starts"
            : "Choose how you'd like to get support"}
        </p>

        {!selectedChannel ? (
          <div className="channel-cards" style={{ marginTop: 24 }}>
            <motion.div
              className="channel-card"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedChannel("ai")}
            >
              <div className="channel-card-icon ai-icon">
                <Bot size={24} />
              </div>
              <h3>AI Assistant</h3>
              <p>Get instant help from our AI</p>
            </motion.div>

            <motion.div
              className="channel-card"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedChannel("human")}
            >
              <div className="channel-card-icon human-icon">
                <Users size={24} />
              </div>
              <h3>Human Agent</h3>
              <p>Talk to a support agent</p>
            </motion.div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 24,
              display: "grid",
              gap: 12,
              textAlign: "left",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <label>Age *</label>
              <input
                className="auth-input"
                type="number"
                min={1}
                max={120}
                value={form.age}
                onChange={(e) => updateField("age", e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Gender *</label>
              <select
                className="auth-input"
                value={form.gender}
                onChange={(e) => updateField("gender", e.target.value)}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Height (cm)</label>
              <input
                className="auth-input"
                type="number"
                min={50}
                max={250}
                value={form.heightCm}
                onChange={(e) => updateField("heightCm", e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Weight (kg)</label>
              <input
                className="auth-input"
                type="number"
                min={2}
                max={300}
                value={form.weightKg}
                onChange={(e) => updateField("weightKg", e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Chronic conditions (comma-separated)</label>
              <input
                className="auth-input"
                type="text"
                value={form.chronicConditions}
                onChange={(e) =>
                  updateField("chronicConditions", e.target.value)
                }
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Symptom duration *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="auth-input"
                  type="number"
                  min={1}
                  max={3650}
                  value={form.symptomDurationValue}
                  onChange={(e) =>
                    updateField("symptomDurationValue", e.target.value)
                  }
                />
                <select
                  className="auth-input"
                  value={form.symptomDurationUnit}
                  onChange={(e) =>
                    updateField("symptomDurationUnit", e.target.value)
                  }
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Pain scale (0-10) *</label>
              <input
                className="auth-input"
                type="number"
                min={0}
                max={10}
                value={form.painScale}
                onChange={(e) => updateField("painScale", e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Main complaint *</label>
              <textarea
                className="auth-input"
                rows={4}
                value={form.mainComplaint}
                onChange={(e) => updateField("mainComplaint", e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "end" }}>
              <button className="btn-secondary" onClick={resetStep}>
                Back
              </button>
              <button className="btn-primary" onClick={handleCreate}>
                Submit Intake & Start Chat
              </button>
            </div>
          </div>
        )}

        {creating && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              marginTop: 16,
              color: "var(--text-muted)",
              fontSize: "0.875rem",
            }}
          >
            Creating conversation…
          </motion.p>
        )}

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              marginTop: 12,
              color: "var(--red)",
              fontSize: "0.8125rem",
            }}
          >
            {error}
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
