import type { QueryClient } from '@tanstack/react-query';
import {
  getGetAdminDashboardQueryKey, getListAdminOrdersQueryKey,
  getListDeletedAdminOrdersQueryKey, getListMyOrdersQueryKey,
  getTrackOrderQueryKey, getListCustomersQueryKey, getListShipmentsQueryKey,
} from '@workspace/api-client-react';

// All customer order views read the same server record and refresh across sessions.
export const orderFreshness = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchInterval: 15000,
};

export function refreshOrderViews(client: QueryClient) {
  return Promise.all([
    getListAdminOrdersQueryKey(), getListDeletedAdminOrdersQueryKey(),
    getGetAdminDashboardQueryKey(), getListMyOrdersQueryKey(),
    getTrackOrderQueryKey(), getListCustomersQueryKey(), getListShipmentsQueryKey(),
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}