import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Menu, MessageCircle, Send, Trash2, UsersRound } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Avatar from '@/components/Avatar';
import {
  apiClient,
  createCommunityInvite,
  createCommunityPost,
  createCommunityPostComment,
  deleteCommunityPost,
  deleteCommunityPostComment,
  fetchCommunity,
  fetchDiscoveryTopics,
  fetchCommunityMembers,
  fetchCommunityPostComments,
  fetchCommunityPosts,
  fetchCommunityRequests,
  joinCommunity,
  normalizeMediaUrl,
  removeCommunityMember,
  removeCommunityPostReaction,
  requestCommunityJoin,
  setCommunityPostReaction,
  updateCommunityDiscovery,
  updateCommunityMemberRestriction,
} from '@/api/client';
import type { CommunityPost } from '@/api/client';
import { useChats } from '@/hooks/useChats';

const REACTIONS = ['❤️', '😂', '😮', '😢', '🙌'];

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function CommunityPostCard({ post }: { post: CommunityPost }) {
  const queryClient = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const comments = useQuery({ queryKey: ['community-post-comments', post.id], queryFn: () => fetchCommunityPostComments(post.id), enabled: commentsOpen });
  const reaction = useMutation({
    mutationFn: (emoji: string) => (post.myReaction === emoji ? removeCommunityPostReaction(post.id) : setCommunityPostReaction(post.id, emoji)),
    onSuccess: (result) => {
      queryClient.setQueriesData({ queryKey: ['community-posts'] }, (old: any) =>
        old ? { ...old, posts: old.posts.map((item: CommunityPost) => item.id === post.id ? { ...item, reactionCounts: result.reactionCounts, myReaction: result.myReaction } : item) } : old
      );
    },
  });
  const comment = useMutation({
    mutationFn: () => createCommunityPostComment(post.id, commentBody),
    onSuccess: (result) => {
      setCommentBody('');
      queryClient.setQueryData(['community-post-comments', post.id], (old: any) => old ? { comments: [...old.comments, result.comment] } : { comments: [result.comment] });
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
    },
  });
  const remove = useMutation({ mutationFn: () => deleteCommunityPost(post.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['community-posts'] }) });

  return (
    <article className="border-b border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={normalizeMediaUrl(post.author.avatarUrl)} alt={post.author.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{post.author.name}</p>
            <p className="truncate text-xs text-slate-500">{post.author.handle ? `@${post.author.handle}` : 'Member'} · {formatTime(post.createdAt)}</p>
          </div>
        </div>
        {post.canDelete && (
          <button onClick={() => remove.mutate()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-900" aria-label="Delete community post">
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {post.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{post.body}</p>}
      {post.media.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {post.media.map((media) => <img key={media.mediaId} src={normalizeMediaUrl(media.url)} alt="" className="aspect-square w-full rounded-lg object-cover" />)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {REACTIONS.map((emoji) => (
          <button key={emoji} onClick={() => reaction.mutate(emoji)} className={`rounded-full border px-2.5 py-1 text-sm ${post.myReaction === emoji ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-slate-200 dark:border-slate-800'}`}>
            {emoji} {post.reactionCounts[emoji] || ''}
          </button>
        ))}
        <button onClick={() => setCommentsOpen(!commentsOpen)} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900">
          <MessageCircle size={15} /> {post.commentCount}
        </button>
      </div>
      {commentsOpen && (
        <div className="mt-4 space-y-3">
          {(comments.data?.comments || []).map((item) => (
            <div key={item.id} className="flex gap-2 text-sm">
              <Avatar src={normalizeMediaUrl(item.author.avatarUrl)} alt={item.author.name} size="sm" />
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                <p className="font-medium">{item.author.name}</p>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{item.body}</p>
              </div>
              {item.canDelete && <button onClick={() => deleteCommunityPostComment(post.id, item.id).then(() => queryClient.invalidateQueries({ queryKey: ['community-post-comments', post.id] }))} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
            </div>
          ))}
          <form onSubmit={(event) => { event.preventDefault(); comment.mutate(); }} className="flex gap-2">
            <input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Comment" />
            <button disabled={!commentBody.trim() || comment.isPending} className="rounded-lg bg-slate-950 px-3 text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"><Send size={15} /></button>
          </form>
        </div>
      )}
    </article>
  );
}

export default function CommunityPage() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [body, setBody] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [shareChatId, setShareChatId] = useState('');
  const [communityTopicIds, setCommunityTopicIds] = useState<string[]>([]);
  const community = useQuery({ queryKey: ['community', handle], queryFn: () => fetchCommunity(handle), retry: false });
  const topics = useQuery({ queryKey: ['discovery-topics'], queryFn: fetchDiscoveryTopics, enabled: Boolean(community.data?.discovery) });
  const posts = useQuery({ queryKey: ['community-posts', handle], queryFn: () => fetchCommunityPosts(handle), enabled: Boolean(community.data?.membership) });
  const members = useQuery({ queryKey: ['community-members', handle], queryFn: () => fetchCommunityMembers(handle), enabled: Boolean(community.data?.membership) });
  const requests = useQuery({ queryKey: ['community-requests', handle], queryFn: () => fetchCommunityRequests(handle), enabled: Boolean(community.data?.canManage) });
  const shareChats = useChats({ archived: false, limit: 50 });
  const createPost = useMutation({ mutationFn: () => createCommunityPost(handle, { body }), onSuccess: () => { setBody(''); queryClient.invalidateQueries({ queryKey: ['community-posts', handle] }); } });
  const join = useMutation({ mutationFn: () => joinCommunity(handle), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['community', handle] }); queryClient.invalidateQueries({ queryKey: ['community-posts', handle] }); } });
  const requestJoin = useMutation({ mutationFn: () => requestCommunityJoin(handle), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['community', handle] }) });
  const invite = useMutation({ mutationFn: () => createCommunityInvite(handle, { expiresIn: '7d', maxUses: 10 }), onSuccess: (result) => setInviteToken(result.token) });
  const inviteUrl = inviteToken ? `${window.location.origin}/communities/join/${encodeURIComponent(inviteToken)}` : '';
  const shareInvite = useMutation({
    mutationFn: async () => {
      if (!shareChatId || !inviteUrl || !community.data) return;
      await apiClient.post(`/api/messages/${shareChatId}`, {
        type: 'text',
        body: `Join ${community.data.name} on Blabber: ${inviteUrl}`,
      });
    },
  });
  const listing = useMutation({
    mutationFn: (enabled: boolean) => updateCommunityDiscovery(handle, { communityDiscoverable: enabled, communityTopicIds: enabled ? communityTopicIds : communityTopicIds.slice(0, 3) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['community', handle] }),
  });
  const effectiveCommunityTopicIds = communityTopicIds.length ? communityTopicIds : (community.data?.discovery?.topicIds || []);
  const toggleCommunityTopic = (topicId: string) => {
    setCommunityTopicIds((current) => {
      const base = current.length ? current : (community.data?.discovery?.topicIds || []);
      return base.includes(topicId) ? base.filter((id) => id !== topicId) : base.length >= 3 ? base : [...base, topicId];
    });
  };

  const submitPost = (event: FormEvent) => {
    event.preventDefault();
    createPost.mutate();
  };

  if (community.isError) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950">Community unavailable</div>;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="hidden md:block"><Sidebar /></div>
      {sidebarOpen && <div className="fixed inset-0 z-40 flex md:hidden"><div className="absolute inset-0 bg-slate-950/40" onClick={() => setSidebarOpen(false)} /><Sidebar onNavigateMobile={() => setSidebarOpen(false)} /></div>}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-900" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <button onClick={() => navigate('/communities')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Communities"><UsersRound size={18} /></button>
          <h1 className="truncate text-base font-semibold">{community.data?.name || 'Community'}</h1>
        </header>
        {community.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading</div>
        ) : community.data && (
          <div className="grid flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0 border-r border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 bg-white px-5 py-5 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start gap-4">
                  {community.data.avatarUrl ? <img src={normalizeMediaUrl(community.data.avatarUrl)} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-900"><UsersRound /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{community.data.name}</p>
                    <p className="text-sm text-slate-500">@{community.data.handle} · {community.data.memberCount} members · {community.data.membershipMode.replace('_', ' ')}</p>
                    {community.data.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{community.data.description}</p>}
                  </div>
                </div>
                {!community.data.membership && (
                  <div className="mt-4">
                    {community.data.membershipMode === 'open' && <button onClick={() => join.mutate()} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">Join</button>}
                    {community.data.membershipMode === 'approval_required' && <button onClick={() => requestJoin.mutate()} disabled={Boolean(community.data.joinRequest)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">{community.data.joinRequest ? 'Requested' : 'Request to join'}</button>}
                  </div>
                )}
              </div>
              {community.data.membership && (
                <>
                  {community.data.canPost && (
                    <form onSubmit={submitPost} className="border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                      <textarea value={body} onChange={(event) => setBody(event.target.value)} className="min-h-24 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Post to this Community" maxLength={2000} />
                      <div className="mt-2 flex justify-end">
                        <button disabled={!body.trim() || createPost.isPending} className="flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950"><Send size={15} /> Post</button>
                      </div>
                    </form>
                  )}
                  {(posts.data?.posts || []).map((post) => <CommunityPostCard key={post.id} post={post} />)}
                </>
              )}
            </section>
            <aside className="space-y-5 bg-white p-5 dark:bg-slate-950">
              {community.data.canManage && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold">Community Controls</h2>
                  {community.data.discovery && community.data.membershipMode === 'open' && (
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <label className="flex items-center justify-between gap-3 text-sm font-medium">
                        <span>List in Discover</span>
                        <input
                          type="checkbox"
                          checked={Boolean(community.data.discovery.communityDiscoverable)}
                          onChange={(event) => listing.mutate(event.target.checked)}
                          disabled={listing.isPending || (effectiveCommunityTopicIds.length === 0 && !community.data.discovery.communityDiscoverable)}
                          className="h-4 w-4 accent-teal-600"
                          aria-label="List in Discover"
                        />
                      </label>
                      <p className="mt-1 text-xs text-slate-500">This open Community can appear in Discover. Community posts stay member-only.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(topics.data || []).slice(0, 8).map((topic) => (
                          <button
                            key={topic.id}
                            onClick={() => toggleCommunityTopic(topic.id)}
                            className={`rounded-md border px-2 py-1 text-xs ${effectiveCommunityTopicIds.includes(topic.id) ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-200' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}
                          >
                            {topic.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => invite.mutate()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">Create invite</button>
                  {inviteUrl && (
                    <div className="space-y-2 rounded-lg bg-slate-100 p-2 text-xs dark:bg-slate-900">
                      <a href={inviteUrl} className="break-all font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300">{inviteUrl}</a>
                      <select value={shareChatId} onChange={(event) => setShareChatId(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950">
                        <option value="">Share to Conversation</option>
                        {(shareChats.data || []).map((chat) => <option key={chat._id} value={chat._id}>{chat.title || (chat.type === 'direct' ? 'Direct conversation' : 'Group conversation')}</option>)}
                      </select>
                      <button onClick={() => shareInvite.mutate()} disabled={!shareChatId || shareInvite.isPending} className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
                        {shareInvite.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Send invite
                      </button>
                      {shareInvite.isSuccess && <p className="text-teal-700 dark:text-teal-300">Invite sent.</p>}
                    </div>
                  )}
                  {(requests.data?.requests || []).map((request) => <p key={request.id} className="text-sm text-slate-500">{request.requester.name} requested access</p>)}
                </div>
              )}
              <div>
                <h2 className="mb-3 text-sm font-semibold">Members</h2>
                <div className="space-y-3">
                  {(members.data?.members || []).map((member) => (
                    <div key={member.user.id} className="flex items-center gap-2 text-sm">
                      <Avatar src={normalizeMediaUrl(member.user.avatarUrl)} alt={member.user.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{member.user.name}</p>
                        <p className="text-xs text-slate-500">{member.role}{member.postingRestricted ? ' · restricted' : ''}</p>
                      </div>
                      {community.data?.canModerate && member.role === 'member' && (
                        <button onClick={() => updateCommunityMemberRestriction(handle, member.user.id, !member.postingRestricted).then(() => queryClient.invalidateQueries({ queryKey: ['community-members', handle] }))} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
                          {member.postingRestricted ? 'Unrestrict' : 'Restrict'}
                        </button>
                      )}
                      {community.data?.canModerate && member.role === 'member' && (
                        <button onClick={() => removeCommunityMember(handle, member.user.id).then(() => queryClient.invalidateQueries({ queryKey: ['community-members', handle] }))} className="text-xs text-rose-600">Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
