'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, ExternalLink } from 'lucide-react'

const BRAND = '#7C2D2D'

interface Org {
  id: string
  slug: string
  name: string
  created_at: string
}

function NotusLogo() {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: BRAND }}>
      <span className="text-white font-bold text-xl leading-none" style={{ fontFamily: 'Georgia, serif' }}>n</span>
    </div>
  )
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  function headers() {
    return { 'Content-Type': 'application/json', 'x-admin-password': password }
  }

  async function login() {
    setLoading(true)
    const res = await fetch('/api/admin/orgs', { headers: { 'x-admin-password': password } })
    if (res.ok) {
      const data = await res.json()
      setOrgs(data)
      setAuthed(true)
    } else if (res.status === 401) {
      setAuthError('Wrong password')
    } else {
      setAuthError(`Server error (${res.status}) — check Vercel env vars`)
    }
    setLoading(false)
  }

  async function loadOrgs() {
    const res = await fetch('/api/admin/orgs', { headers: { 'x-admin-password': password } })
    if (res.ok) setOrgs(await res.json())
  }

  async function createOrg() {
    if (!newSlug.trim() || !newName.trim()) return
    setCreating(true); setCreateError('')
    const res = await fetch('/api/admin/orgs', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ slug: newSlug.trim().toLowerCase().replace(/\s+/g, '-'), name: newName.trim() }),
    })
    if (res.ok) {
      setNewSlug(''); setNewName(''); setShowCreate(false)
      await loadOrgs()
    } else {
      const err = await res.json()
      setCreateError(err.error ?? 'Failed to create')
    }
    setCreating(false)
  }

  async function deleteOrg(slug: string, name: string) {
    if (!confirm(`Delete "${name}" and all its data? This cannot be undone.`)) return
    await fetch(`/api/admin/orgs/${slug}`, { method: 'DELETE', headers: headers() })
    await loadOrgs()
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#F6F3EF] flex items-center justify-center">
        <div className="bg-white border border-[#EDE9E4] rounded-2xl p-8 w-80 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <NotusLogo />
            <div>
              <p className="text-sm font-semibold text-[#1C1917]">Admin Panel</p>
              <p className="text-xs text-[#A8A29E]">notus dashboard management</p>
            </div>
          </div>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
            className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#C7BFB8] mb-3"
          />
          {authError && <p className="text-xs text-red-500 mb-3">{authError}</p>}
          <button onClick={login} disabled={loading || !password}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: BRAND }}>
            {loading ? 'Checking…' : 'Sign in'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F6F3EF]">
      <header className="bg-white border-b border-[#EDE9E4] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NotusLogo />
            <div>
              <p className="text-sm font-semibold text-[#1C1917]">Dashboard Admin</p>
              <p className="text-xs text-[#A8A29E]">Manage client organizations</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(s => !s)}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: BRAND }}>
            <Plus className="w-4 h-4" /> New Org
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        {showCreate && (
          <div className="bg-white border border-[#EDE9E4] rounded-xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-4">New Organization</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-[#A8A29E] block mb-1.5">Name *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. FBF"
                  className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#C7BFB8]" />
              </div>
              <div>
                <label className="text-xs text-[#A8A29E] block mb-1.5">Slug (URL) *</label>
                <input value={newSlug} onChange={e => setNewSlug(e.target.value)} placeholder="e.g. fbf"
                  className="w-full bg-[#FAFAF9] border border-[#EDE9E4] text-[#1C1917] text-sm rounded-lg px-3 py-2.5 outline-none placeholder:text-[#C7BFB8]" />
              </div>
            </div>
            {createError && <p className="text-xs text-red-500 mb-3">{createError}</p>}
            <p className="text-xs text-[#A8A29E] mb-3">Dashboard will be at <span className="font-mono text-[#78716C]">yourdomain.com/{newSlug || 'slug'}</span></p>
            <div className="flex gap-2">
              <button onClick={createOrg} disabled={creating || !newSlug.trim() || !newName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: BRAND }}>
                {creating ? 'Creating…' : 'Create Organization'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 rounded-xl text-sm text-[#78716C] border border-[#EDE9E4]">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A8A29E] mb-3">Organizations ({orgs.length})</p>
          {orgs.length === 0 ? (
            <div className="bg-white border border-dashed border-[#EDE9E4] rounded-xl p-8 text-center">
              <p className="text-sm text-[#A8A29E]">No organizations yet. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orgs.map(org => (
                <div key={org.id} className="bg-white border border-[#EDE9E4] rounded-xl p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                      style={{ backgroundColor: BRAND }}>
                      {org.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1C1917]">{org.name}</p>
                      <p className="text-xs text-[#A8A29E] font-mono">/{org.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a href={`/${org.slug}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#EDE9E4] text-[#78716C] hover:bg-[#F6F3EF] transition-colors">
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                    <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/${org.slug}`)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#EDE9E4] text-[#78716C] hover:bg-[#F6F3EF] transition-colors">
                      Copy Link
                    </button>
                    <button onClick={() => deleteOrg(org.slug, org.name)}
                      className="text-[#C7BFB8] hover:text-red-400 p-1.5 rounded hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
