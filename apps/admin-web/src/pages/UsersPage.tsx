import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDelete } from '../lib/api';
import { Search, Trash2, Eye } from 'lucide-react';
import { EndlessTail, PaginationFooter, SortHeader, useAdminTableQuery } from '../components/admin-table';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const table = useAdminTableQuery<any>({
    defaultSort: { field: 'created_at', dir: 'desc' },
    defaultPerPage: 20,
    filterKey: `${search}|${statusFilter}`,
    fetcher: ({ page, perPage, sortBy, sortDir }) => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      return apiGet<any>(`/users?${params}`).then((r) => ({
        data: r.data || [],
        total: r.total || 0,
      }));
    },
  });
  const users = table.rows;
  const { page, perPage, total, sortBy, sortDir, paginationMode } = table;

  const handleHardDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiDelete(`/users/${deleteTarget.id}/hard`);
      setDeleteTarget(null);
      table.refresh();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    table.setPage(1);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Users</h2>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="rounded-lg border pl-9 pr-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
            Search
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); table.setPage(1); }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <SortHeader label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="px-6 py-3 font-medium">Phone</th>
              <SortHeader label="Email" field="email" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <SortHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="px-6 py-3 font-medium">Whitelisted</th>
              <SortHeader label="Joined" field="created_at" sortBy={sortBy} sortDir={sortDir} onSort={table.handleSort} />
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b hover:bg-gray-50">
                <td className="px-6 py-4">
                  <Link to={`/admin/users/${user.id}`} className="font-medium text-indigo-600 hover:underline">
                    {user.name}
                  </Link>
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {user.user_phones?.find((p: any) => p.is_primary)?.phone_number || '-'}
                </td>
                <td className="px-6 py-4 text-gray-600">{user.email || '-'}</td>
                <td className="px-6 py-4">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.status === 'active' ? 'bg-green-100 text-green-700' :
                    user.status === 'frozen' ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4">{user.is_whitelisted ? 'Yes' : 'No'}</td>
                <td className="px-6 py-4 text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                      title="View user"
                    >
                      <Eye size={16} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: user.id, name: user.name })}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete user"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No users found</td></tr>
            )}
          </tbody>
        </table>

        <EndlessTail
          paginationMode={paginationMode}
          hasMore={table.hasMoreEndless}
          isLoadingMore={table.isLoadingMore}
          total={total}
          sentinelRef={table.sentinelRef}
          itemLabel="user"
        />

        <PaginationFooter
          page={page}
          perPage={perPage}
          total={total}
          loadedCount={users.length}
          paginationMode={paginationMode}
          onPageChange={table.setPage}
          onPerPageChange={table.setPerPage}
          onPaginationModeChange={table.switchPaginationMode}
          itemLabel="User"
          itemLabelPlural="Users"
        />
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete User</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to permanently delete <strong>{deleteTarget.name}</strong>? This will remove all their data (phones, addresses, payment methods, etc.) and cannot be undone.
            </p>
            {deleteError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                disabled={deleting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleHardDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
