import { useEffect, useState } from "react";
import { api } from "../../services/http";
import { useAuthStore } from "../../stores/authStore";
import { isInFeishuApp } from "../../shared/utils/feishu";
import type { FeishuEnterpriseConfig, User } from "../../types";

type AnchorProfile = {
  id: string;
  douyinUid: string;
  douyinNo: string | null;
  nickname: string;
  hallOrgId: string;
  status: string;
};

export function SettingsPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bindLoading, setBindLoading] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [bindMessage, setBindMessage] = useState("");
  const [bindError, setBindError] = useState("");
  const [baseOptions, setBaseOptions] = useState<FeishuEnterpriseConfig["baseOrg"][]>([]);
  const [teamOptions, setTeamOptions] = useState<FeishuEnterpriseConfig["teamOrg"][]>([]);
  const [configOptions, setConfigOptions] = useState<FeishuEnterpriseConfig[]>([]);
  const [boundConfig, setBoundConfig] = useState<FeishuEnterpriseConfig | null>(null);
  const [baseOptionsLoading, setBaseOptionsLoading] = useState(true);
  const [teamOptionsLoading, setTeamOptionsLoading] = useState(false);
  const [configOptionsLoading, setConfigOptionsLoading] = useState(false);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");

  // 修改手机号
  const [phoneCurrentPassword, setPhoneCurrentPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [phoneMessage, setPhoneMessage] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  // 修改抖音号
  const [anchorProfiles, setAnchorProfiles] = useState<AnchorProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [newDouyinNo, setNewDouyinNo] = useState("");
  const [douyinMessage, setDouyinMessage] = useState("");
  const [douyinError, setDouyinError] = useState("");
  const [douyinLoading, setDouyinLoading] = useState(false);

  // 折叠状态
  const [openSection, setOpenSection] = useState<"password" | "phone" | "douyin" | null>(null);
  function toggleSection(key: "password" | "phone" | "douyin") {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  const [freshUser, setFreshUser] = useState<User | null>(null);
  useEffect(() => {
    api.get<User>("/me")
      .then(setFreshUser)
      .catch(() => setFreshUser(null));
  }, [bindMessage]);

  // 加载当前用户绑定的主播档案
  useEffect(() => {
    api.get<AnchorProfile[]>("/me/anchor-profiles")
      .then((profiles) => {
        setAnchorProfiles(profiles);
        if (profiles.length === 1) {
          setSelectedProfileId(profiles[0].id);
          setNewDouyinNo(profiles[0].douyinNo ?? "");
        }
      })
      .catch(() => setAnchorProfiles([]));
  }, [douyinMessage]);

  useEffect(() => {
    let cancelled = false;
    setBaseOptionsLoading(true);
    api.get<FeishuEnterpriseConfig["baseOrg"][]>("/auth/feishu/base-options")
      .then((bases) => {
        if (cancelled) return;
        setBaseOptions(bases);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书基地失败");
      })
      .finally(() => {
        if (!cancelled) setBaseOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayUser = freshUser ?? user;
  const isBound = !!displayUser?.feishuBoundAt;
  const feishuOptionsLoading = baseOptionsLoading || teamOptionsLoading || configOptionsLoading;

  useEffect(() => {
    const configId = displayUser?.feishuConfigId;
    if (!configId) {
      setBoundConfig(null);
      return;
    }

    let cancelled = false;
    api.get<FeishuEnterpriseConfig[]>(`/auth/feishu/configs?configId=${encodeURIComponent(configId)}`)
      .then((configs) => {
        if (cancelled) return;
        const currentConfig = configs[0] ?? null;
        setBoundConfig(currentConfig);
        if (!currentConfig) return;
        setSelectedBaseId(currentConfig.baseOrgId);
        setSelectedTeamId(currentConfig.teamOrgId);
        setSelectedConfigId(currentConfig.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setBoundConfig(null);
        setBindError(err instanceof Error ? err.message : "加载当前飞书绑定信息失败");
      });
    return () => {
      cancelled = true;
    };
  }, [displayUser?.feishuConfigId]);

  useEffect(() => {
    if (!selectedBaseId) {
      setTeamOptions([]);
      setConfigOptions([]);
      setTeamOptionsLoading(false);
      setConfigOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setTeamOptions([]);
    setConfigOptions([]);
    setTeamOptionsLoading(true);
    api.get<FeishuEnterpriseConfig["teamOrg"][]>(`/auth/feishu/team-options?baseOrgId=${encodeURIComponent(selectedBaseId)}`)
      .then((teams) => {
        if (cancelled) return;
        setTeamOptions(teams);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书团队失败");
      })
      .finally(() => {
        if (!cancelled) setTeamOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId]);

  useEffect(() => {
    if (!selectedBaseId || !selectedTeamId) {
      setConfigOptions([]);
      setConfigOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setConfigOptions([]);
    setConfigOptionsLoading(true);
    api.get<FeishuEnterpriseConfig[]>(`/auth/feishu/configs?baseOrgId=${encodeURIComponent(selectedBaseId)}&teamOrgId=${encodeURIComponent(selectedTeamId)}`)
      .then((configs) => {
        if (cancelled) return;
        setConfigOptions(configs);
      })
      .catch((err) => {
        if (cancelled) return;
        setBindError(err instanceof Error ? err.message : "加载飞书企业失败");
      })
      .finally(() => {
        if (!cancelled) setConfigOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId, selectedTeamId]);

  async function submitPhoneChange() {
    setPhoneMessage("");
    setPhoneError("");
    if (!phoneCurrentPassword || !newPhone) return setPhoneError("请填写当前密码和新手机号");
    if (!/^1[3-9]\d{9}$/.test(newPhone)) return setPhoneError("手机号格式不正确（11位大陆手机号）");
    setPhoneLoading(true);
    try {
      const updated = await api.patch<User>("/auth/update-phone", { currentPassword: phoneCurrentPassword, newPhone });
      setPhoneMessage("手机号已修改成功");
      setPhoneCurrentPassword("");
      setNewPhone("");
      setFreshUser(updated);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "修改手机号失败");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function submitDouyinNoChange() {
    setDouyinMessage("");
    setDouyinError("");
    if (!selectedProfileId) return setDouyinError("请选择要修改的主播档案");
    if (!newDouyinNo.trim()) return setDouyinError("请填写新抖音号");
    setDouyinLoading(true);
    try {
      await api.patch(`/me/anchor-profiles/${selectedProfileId}`, { douyinNo: newDouyinNo.trim() });
      setDouyinMessage("抖音号已修改成功");
    } catch (err) {
      setDouyinError(err instanceof Error ? err.message : "修改抖音号失败");
    } finally {
      setDouyinLoading(false);
    }
  }

  async function submitPasswordChange() {

    setMessage("");
    setError("");
    if (!oldPassword || !newPassword) return setError("请填写旧密码和新密码");
    if (newPassword.length < 8) return setError("新密码至少 8 位");
    if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致");
    setLoading(true);
    try {
      await api.post("/auth/change-password", { oldPassword, newPassword });
      setMessage("密码已修改成功");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setLoading(false);
    }
  }

  function ensureFeishuSelection() {
    if (!selectedBaseId) {
      setBindError("请先选择基地");
      return false;
    }
    if (!selectedTeamId) {
      setBindError("请先选择团队");
      return false;
    }
    if (!selectedConfigId) {
      setBindError("请先选择飞书企业");
      return false;
    }
    return true;
  }

  async function handleBindFeishu() {
    setBindError("");
    setBindMessage("");
    setBindLoading(true);

    try {
      if (!token) {
        setBindError("未登录，无法绑定");
        return;
      }
      if (!ensureFeishuSelection()) return;
      sessionStorage.setItem("feishu_bind_token", token);
      window.location.href = `/api/auth/feishu/login?action=bind&token=${encodeURIComponent(token)}&configId=${encodeURIComponent(selectedConfigId)}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "绑定失败，请重试";
      setBindError(msg);
    } finally {
      setBindLoading(false);
    }
  }

  async function handleUnbindFeishu() {
    setBindError("");
    setBindMessage("");
    if (!window.confirm("确定要解绑当前飞书账号吗？解绑后将不能使用飞书自动登录。")) return;

    setUnbindLoading(true);
    try {
      await api.delete<{ bound: boolean }>("/auth/feishu/bind");
      setFreshUser((prev) => prev ? ({
        ...prev,
        feishuConfigId: null,
        feishuName: null,
        feishuBoundAt: null,
        feishuOpenId: null,
        feishuUnionId: null,
        feishuAvatarUrl: null,
      }) : prev);
      setBindMessage("飞书账号已解绑。解绑后将不能使用飞书自动登录。");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解绑失败，请重试";
      setBindError(msg);
    } finally {
      setUnbindLoading(false);
    }
  }




  return (
    <div className="space-y-6">
      <section className="feishu-panel p-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">个人账号管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          {displayUser?.nickname}（{displayUser?.phone}）
        </p>
      </section>

      {/* 折叠卡片区 */}
      <section className="feishu-panel overflow-hidden">
        {/* 修改密码 */}
        <div className="border-b border-slate-100 last:border-b-0">
          <button
            type="button"
            className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-slate-50/60"
            onClick={() => toggleSection("password")}
          >
            <div>
              <p className="text-base font-semibold text-slate-900">修改密码</p>
              {(message || error) && (
                <p className={`mt-0.5 text-xs ${error ? "text-red-500" : "text-emerald-600"}`}>{error || message}</p>
              )}
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 ${openSection === "password" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {openSection === "password" ? "折叠" : "展开"}
              <svg className={`h-3 w-3 transition-transform duration-200 ${openSection === "password" ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </span>
          </button>
          {openSection === "password" && (
            <div className="px-6 pb-6">
              <div className="grid max-w-xl gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">旧密码</span>
                  <input className="feishu-input mt-2" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">新密码</span>
                  <input className="feishu-input mt-2" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">确认新密码</span>
                  <input className="feishu-input mt-2" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </label>
                <button className="feishu-button-primary w-full sm:w-fit" disabled={loading} onClick={submitPasswordChange}>
                  {loading ? "提交中..." : "保存新密码"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 修改手机号 */}
        <div className="border-b border-slate-100 last:border-b-0">
          <button
            type="button"
            className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-slate-50/60"
            onClick={() => toggleSection("phone")}
          >
            <div>
              <p className="text-base font-semibold text-slate-900">修改手机号</p>
              {(phoneMessage || phoneError) && (
                <p className={`mt-0.5 text-xs ${phoneError ? "text-red-500" : "text-emerald-600"}`}>{phoneError || phoneMessage}</p>
              )}
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 ${openSection === "phone" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {openSection === "phone" ? "折叠" : "展开"}
              <svg className={`h-3 w-3 transition-transform duration-200 ${openSection === "phone" ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </span>
          </button>
          {openSection === "phone" && (
            <div className="px-6 pb-6">
              <p className="mb-4 text-sm text-slate-500">手机号是登录凭证，修改后请使用新手机号登录。需验证当前密码以确认身份。</p>
              <div className="grid max-w-xl gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">当前密码</span>
                  <input className="feishu-input mt-2" type="password" value={phoneCurrentPassword} onChange={(e) => setPhoneCurrentPassword(e.target.value)} placeholder="请输入当前登录密码" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">新手机号</span>
                  <input className="feishu-input mt-2" type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="请输入新手机号（11位）" maxLength={11} />
                </label>
                <button className="feishu-button-primary w-full sm:w-fit" disabled={phoneLoading} onClick={submitPhoneChange}>
                  {phoneLoading ? "提交中..." : "保存新手机号"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 修改抖音号 */}
        {anchorProfiles.length > 0 && (
          <div className="border-b border-slate-100 last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-slate-50/60"
              onClick={() => toggleSection("douyin")}
            >
              <div>
                <p className="text-base font-semibold text-slate-900">修改抖音号</p>
                {(douyinMessage || douyinError) && (
                  <p className={`mt-0.5 text-xs ${douyinError ? "text-red-500" : "text-emerald-600"}`}>{douyinError || douyinMessage}</p>
                )}
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 ${openSection === "douyin" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                {openSection === "douyin" ? "折叠" : "展开"}
                <svg className={`h-3 w-3 transition-transform duration-200 ${openSection === "douyin" ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </span>
            </button>
            {openSection === "douyin" && (
              <div className="px-6 pb-6">
                <p className="mb-4 text-sm text-slate-500">修改当前账号绑定的主播档案的抖音号（展示用，不影响登录）。</p>
                <div className="grid max-w-xl gap-4">
                  {anchorProfiles.length > 1 && (
                    <label className="block">
                      <span className="text-xs font-medium text-slate-500">选择主播档案</span>
                      <select
                        className="feishu-input mt-2"
                        value={selectedProfileId}
                        onChange={(e) => {
                          setSelectedProfileId(e.target.value);
                          const profile = anchorProfiles.find((p) => p.id === e.target.value);
                          setNewDouyinNo(profile?.douyinNo ?? "");
                          setDouyinMessage("");
                          setDouyinError("");
                        }}
                      >
                        <option value="">请选择主播档案</option>
                        {anchorProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.nickname}（{p.douyinNo || "未填写抖音号"}）</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {anchorProfiles.length === 1 && (
                    <div className="rounded-[16px] border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                      当前主播档案：<span className="font-medium">{anchorProfiles[0].nickname}</span>
                      {anchorProfiles[0].douyinNo && <span className="ml-2 text-slate-400">现抖音号：{anchorProfiles[0].douyinNo}</span>}
                    </div>
                  )}
                  <label className="block">
                    <span className="text-xs font-medium text-slate-500">新抖音号</span>
                    <input
                      className="feishu-input mt-2"
                      type="text"
                      value={newDouyinNo}
                      onChange={(e) => setNewDouyinNo(e.target.value)}
                      placeholder="请输入新的抖音号"
                      disabled={!selectedProfileId}
                    />
                  </label>
                  <button className="feishu-button-primary w-full sm:w-fit" disabled={douyinLoading || !selectedProfileId} onClick={submitDouyinNoChange}>
                    {douyinLoading ? "提交中..." : "保存新抖音号"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="feishu-panel p-6">
        <h2 className="text-xl font-semibold text-slate-950">飞书绑定</h2>

        <div className="mt-4 rounded-[20px] border border-slate-100 bg-slate-50/80 p-4">
          <p className="text-sm font-medium text-slate-700">绑定前请选择基地、团队与飞书企业</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">基地</span>
              <select
                className="feishu-input mt-2"
                value={selectedBaseId}
                onChange={(e) => {
                  setSelectedBaseId(e.target.value);
                  setSelectedTeamId("");
                  setSelectedConfigId("");
                }}
                disabled={feishuOptionsLoading}
              >
                <option value="">请选择基地</option>
                {baseOptions.map((base) => (
                  <option key={base.id} value={base.id}>{base.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">团队</span>
              <select
                className="feishu-input mt-2"
                value={selectedTeamId}
                onChange={(e) => {
                  setSelectedTeamId(e.target.value);
                  setSelectedConfigId("");
                }}
                disabled={!selectedBaseId || feishuOptionsLoading}
              >
                <option value="">请选择团队</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">飞书企业</span>
              <select
                className="feishu-input mt-2"
                value={selectedConfigId}
                onChange={(e) => setSelectedConfigId(e.target.value)}
                disabled={!selectedTeamId || feishuOptionsLoading}
              >
                <option value="">请选择飞书企业</option>
                {configOptions.map((config) => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isBound ? (
          <>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-feishu-pale text-sm font-semibold text-feishu-blue">
                {displayUser?.feishuName?.slice(0, 1) ?? "飞"}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">{displayUser?.feishuName ?? "已绑定"}</p>
                <p className="text-xs text-slate-400">
                  {boundConfig ? `${boundConfig.baseOrg.name} / ${boundConfig.teamOrg.name} / ${boundConfig.name}` : "飞书账号已绑定，可在飞书 App 内自动登录"}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">已绑定</span>
                <button
                  className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={unbindLoading}
                  onClick={handleUnbindFeishu}
                >
                  {unbindLoading ? "解绑中..." : "解绑"}
                </button>
              </div>
            </div>
            {(bindMessage || bindError) && (
              <div className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${bindError ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {bindError || bindMessage}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-500">
              {isInFeishuApp()
                ? "检测到飞书 App 环境，选择归属后可直接授权绑定当前飞书账号。"
                : "绑定后可在飞书 App 内自动登录，无需手动输入账号密码。"}
            </p>
            {(bindMessage || bindError) && (
              <div className={`mt-3 rounded-[16px] border px-4 py-3 text-sm ${bindError ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {bindError || bindMessage}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="feishu-button-secondary"
                type="button"
                disabled={bindLoading || feishuOptionsLoading}
                onClick={handleBindFeishu}
              >
                {bindLoading ? "绑定中..." : feishuOptionsLoading ? "加载飞书选项中..." : isInFeishuApp() ? "授权绑定当前飞书账号" : "绑定飞书"}

              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
