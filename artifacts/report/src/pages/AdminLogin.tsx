import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const { login, isLoggingIn } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ data: { password } });
      toast({ title: "Authorization Granted", description: "Secure session established." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid security credential.";
      toast({ 
        title: "Access Denied", 
        description: message, 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden px-4">
      {/* Abstract Background elements */}
      <div className="absolute inset-0 z-0 opacity-10 mix-blend-screen pointer-events-none">
        <img src={`${import.meta.env.BASE_URL}images/abstract-neon.png`} alt="Abstract Neon" className="w-full h-full object-cover" />
      </div>
      <div className="absolute top-1/4 -left-32 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] bg-secondary/20 rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="z-10 w-full max-w-md"
      >
        <Card className="bg-card/40 backdrop-blur-2xl border-border/50 shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-secondary" />
          <CardHeader className="text-center pb-8 pt-10">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-6 border border-primary/20 shadow-[inset_0_0_20px_rgba(0,240,255,0.1)]">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="font-serif text-3xl font-bold tracking-tight text-foreground/90">System Access</CardTitle>
            <CardDescription className="font-display tracking-[0.2em] uppercase text-[10px] mt-4 text-muted-foreground">
              State of AI Report • Contributor Portal
            </CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-10">
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2 relative">
                <Input
                  type="password"
                  placeholder="Enter Passcode"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/50 border-border/50 h-14 text-center text-lg tracking-[0.3em] font-mono focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-all rounded-xl"
                  required
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-14 font-display uppercase tracking-[0.2em] text-xs bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/30 rounded-xl transition-all duration-300"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? "Authenticating..." : "Initialize Session"}
              </Button>
            </form>
          </CardContent>
        </Card>
        
        <div className="mt-8 text-center">
          <Link href="/" className="text-muted-foreground hover:text-foreground text-xs font-display uppercase tracking-widest transition-colors">
            ← Return to Public Report
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
