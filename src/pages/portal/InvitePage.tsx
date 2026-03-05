import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) {
      localStorage.setItem("referral_code", code);
    }
    navigate("/auth", { replace: true });
  }, [code, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--portal-bg)" }}>
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-accent)" }} />
    </div>
  );
}
