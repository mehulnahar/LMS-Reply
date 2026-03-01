import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import Layout from "../components/Layout";

export default function Dashboard() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [keys, setKeys] = useState([]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.getKeys().then(setKeys).catch(() => {});
  }, []);

  const connectedCount = keys.filter((k) => k.status === "connected").length;

  return (
    <Layout>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Here's an overview of your LMS Reply setup
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatusCard
          title="System Status"
          value={health?.status === "healthy" ? "Healthy" : "Checking..."}
          subtitle={health ? `DB: ${health.database}` : ""}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatusCard
          title="API Keys"
          value={`${connectedCount} connected`}
          subtitle={`${2 - connectedCount} remaining`}
          color="brand"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          }
        />
        <StatusCard
          title="Account"
          value={user?.role === "owner" ? "Owner" : user?.role?.toUpperCase()}
          subtitle={user?.email}
          color="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          }
        />
      </div>

      {/* Quick Actions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Quick Setup</h2>
        <div className="space-y-3">
          <SetupStep
            step={1}
            title="Configure API Keys"
            description="Add your Anthropic and LeadHack API keys to enable AI replies and job matching"
            done={connectedCount >= 2}
            action={<Link to="/settings" className="btn-primary text-xs px-3 py-1.5">Configure</Link>}
          />
          <SetupStep
            step={2}
            title="Connect Gmail"
            description="Link your Gmail accounts to start pulling Upwork emails"
            done={false}
            action={<span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Coming soon</span>}
          />
          <SetupStep
            step={3}
            title="Set Reply Templates"
            description="Customize prompt templates for AI-generated replies"
            done={false}
            action={<span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Coming soon</span>}
          />
        </div>
      </div>
    </Layout>
  );
}

function StatusCard({ title, value, subtitle, color, icon }) {
  const colors = {
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-900/20 dark:text-brand-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
          {icon}
        </div>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</span>
      </div>
      <p className="text-xl font-semibold">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function SetupStep({ step, title, description, done, action }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold
        ${done
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
        }`}
      >
        {done ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : step}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      {action}
    </div>
  );
}
