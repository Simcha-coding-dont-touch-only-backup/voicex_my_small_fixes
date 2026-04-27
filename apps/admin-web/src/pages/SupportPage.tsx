import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { apiGet, apiPatch } from '../lib/api';

type ContactStatus = 'new' | 'in_review' | 'resolved' | 'archived';
type ContactRole = 'merchant' | 'investor' | 'partner' | 'press' | 'other';

interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: ContactRole;
  message: string;
  status: ContactStatus;
  admin_notes: string | null;
  handled_by: string | null;
  handled_at: string | null;
  source_path: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  success: boolean;
  data: ContactSubmission[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface DetailResponse {
  success: boolean;
  data: ContactSubmission;
}

const PER_PAGE = 20;

const STATUS_LABELS: Record<ContactStatus, string> = {
  new: 'New',
  in_review: 'In review',
  resolved: 'Resolved',
  archived: 'Archived',
};

const ROLE_LABELS: Record<ContactRole, string> = {
  merchant: 'Merchant or retailer',
  investor: 'Investor',
  partner: 'Partner / integrator',
  press: 'Press',
  other: 'Other',
};

function formatDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

function statusClass(status: ContactStatus) {
  switch (status) {
    case 'new':
      return 'bg-blue-100 text-blue-700';
    case 'in_review':
      return 'bg-yellow-100 text-yellow-700';
    case 'resolved':
      return 'bg-green-100 text-green-700';
    case 'archived':
      return 'bg-gray-100 text-gray-600';
  }
}

function preview(text: string) {
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

export function SupportPage() {
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [selected, setSelected] = useState<ContactSubmission | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draftStatus, setDraftStatus] = useState<ContactStatus>('new');
  const [draftNotes, setDraftNotes] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (statusFilter) params.set('status', statusFilter);
      if (roleFilter) params.set('role', roleFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (search) params.set('search', search);

      const response = await apiGet<ListResponse>(`/support/contact-submissions?${params}`);
      setSubmissions(response.data || []);
      setTotal(response.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contact submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, statusFilter, roleFilter, dateFrom, dateTo, search]);

  const openSubmission = async (submission: ContactSubmission) => {
    setSelected(submission);
    setDraftStatus(submission.status);
    setDraftNotes(submission.admin_notes || '');
    setDetailLoading(true);
    setError('');

    try {
      const response = await apiGet<DetailResponse>(`/support/contact-submissions/${submission.id}`);
      setSelected(response.data);
      setDraftStatus(response.data.status);
      setDraftNotes(response.data.admin_notes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contact submission');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveSelected = async () => {
    if (!selected) return;

    setSaving(true);
    setError('');
    try {
      const response = await apiPatch<DetailResponse>(`/support/contact-submissions/${selected.id}`, {
        status: draftStatus,
        admin_notes: draftNotes,
      });

      setSelected(response.data);
      setDraftStatus(response.data.status);
      setDraftNotes(response.data.admin_notes || '');
      setSubmissions((prev) => prev.map((item) => (item.id === response.data.id ? response.data : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save contact submission');
    } finally {
      setSaving(false);
    }
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const resetFilters = () => {
    setStatusFilter('');
    setRoleFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const rangeEnd = Math.min(page * PER_PAGE, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Support Management</h2>
          <p className="mt-1 text-sm text-gray-500">
            Review and manage contact forms submitted from the marketing site.
          </p>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 text-sm shadow-sm">
          <span className="font-semibold text-gray-800">{total}</span>
          <span className="ml-1 text-gray-500">submission{total === 1 ? '' : 's'}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={submitSearch} className="flex min-w-[260px] flex-1 items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-lg border px-9 py-2 text-sm"
                placeholder="Search name, email, company, or message"
              />
            </div>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Search
            </button>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <select
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border px-3 py-2 text-sm"
          />

          <button type="button" onClick={resetFilters} className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b px-6 py-3 text-sm text-gray-500">
            {loading ? 'Loading...' : `Showing ${rangeStart}-${rangeEnd} of ${total}`}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-6 py-3 font-medium">Submitted</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Contact</th>
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Message</th>
                  <th className="px-6 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr
                    key={submission.id}
                    onClick={() => openSubmission(submission)}
                    className={`cursor-pointer border-b hover:bg-gray-50 ${
                      selected?.id === submission.id ? 'bg-indigo-50/60' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-6 py-3 text-gray-500">{formatDate(submission.created_at)}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(submission.status)}`}>
                        {STATUS_LABELS[submission.status]}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-800">{submission.name}</div>
                      <a
                        href={`mailto:${submission.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        {submission.email}
                      </a>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{submission.company || '-'}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-gray-600">{ROLE_LABELS[submission.role]}</td>
                    <td className="min-w-[260px] px-6 py-3 text-gray-600">{preview(submission.message)}</td>
                    <td className="px-6 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSubmission(submission);
                        }}
                        className="rounded-lg border px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && submissions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-400">
                      No contact submissions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t px-6 py-3">
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <aside className="rounded-xl bg-white p-6 shadow-sm">
          {!selected ? (
            <div className="flex min-h-[320px] items-center justify-center text-center text-sm text-gray-400">
              Select a contact submission to view details and manage status.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{selected.name}</h3>
                    <a href={`mailto:${selected.email}`} className="text-sm text-indigo-600 hover:underline">
                      {selected.email}
                    </a>
                  </div>
                  {detailLoading && <span className="text-xs text-gray-400">Refreshing...</span>}
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex gap-3"><dt className="w-28 shrink-0 font-medium text-gray-500">Company</dt><dd>{selected.company || '-'}</dd></div>
                  <div className="flex gap-3"><dt className="w-28 shrink-0 font-medium text-gray-500">Role</dt><dd>{ROLE_LABELS[selected.role]}</dd></div>
                  <div className="flex gap-3"><dt className="w-28 shrink-0 font-medium text-gray-500">Submitted</dt><dd>{formatDate(selected.created_at)}</dd></div>
                  <div className="flex gap-3"><dt className="w-28 shrink-0 font-medium text-gray-500">Source</dt><dd>{selected.source_path || '-'}</dd></div>
                  <div className="flex gap-3"><dt className="w-28 shrink-0 font-medium text-gray-500">Handled</dt><dd>{formatDate(selected.handled_at)}</dd></div>
                </dl>
              </div>

              <div className="border-t pt-5">
                <h4 className="mb-2 text-sm font-semibold text-gray-700">Message</h4>
                <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-700">
                  {selected.message}
                </p>
              </div>

              <div className="border-t pt-5">
                <label className="block text-sm font-medium text-gray-700">
                  Status
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value as ContactStatus)}
                    className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="mt-4 block text-sm font-medium text-gray-700">
                  Internal notes
                  <textarea
                    rows={6}
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Add follow-up notes for the support team"
                  />
                </label>

                <button
                  type="button"
                  onClick={saveSelected}
                  disabled={saving}
                  className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
