import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { approveFollowRequest, declineFollowRequest, getMyProfile, listFollowers, listIncomingFollowRequests, listProfileReels, removeFollower, updateMyProfile } from '@/api/blabber';
import { ReelCard } from '@/components/Cards';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';
import { uploadPickedImageForPublishing, type MobileImageUploadState } from '@/uploads/mobile-image-upload';

export default function Profile() {
  const theme = useTheme();
  const profile = useApiResource(() => getMyProfile(), []);
  const requests = useApiResource(() => listIncomingFollowRequests(), []);
  const reels = useApiResource(async () => {
    const handle = profile.data?.profile?.handle;
    return handle ? listProfileReels(handle) : { reels: [] };
  }, [profile.data?.profile?.handle]);
  const followers = useApiResource(async () => {
    const handle = profile.data?.profile?.handle;
    return handle ? listFollowers(handle) : { followers: [] };
  }, [profile.data?.profile?.handle]);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<MobileImageUploadState>('idle');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const item = profile.data?.profile;
    if (!item) return;
    setName(item.name || '');
    setBio(item.bio || '');
    setWebsite(item.website || '');
    setVisibility(item.visibility === 'public' ? 'public' : 'private');
  }, [profile.data?.profile]);

  const save = async () => {
    setBusy(true);
    try {
      await updateMyProfile({ name, bio, website, visibility, avatarMediaId: avatarMediaId || undefined });
      setAvatarMediaId(null);
      await profile.refresh();
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async () => {
    setBusy(true);
    try {
      const uploaded = await uploadPickedImageForPublishing(setUploadState);
      if (uploaded?.status === 'approved') setAvatarMediaId(uploaded.mediaId);
    } finally {
      setBusy(false);
    }
  };

  if (profile.loading && !profile.data) return <LoadingState label="Loading profile..." />;
  const item = profile.data?.profile;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>{item?.name || 'Profile'}</Text>
      {profile.error ? <ErrorState message={profile.error} /> : null}
      <Text style={{ color: theme.muted }}>{item?.displayHandle || item?.handle || ''}</Text>
      <Text style={{ color: theme.text }}>{item?.visibility || item?.profileVisibility || 'Profile visibility managed by server'}</Text>
      <Text style={{ color: theme.muted }}>{item?.counts?.followers ?? 0} followers · {item?.counts?.following ?? 0} following</Text>
      <Link href="/settings/mobile" style={{ color: theme.primary }}>Mobile settings</Link>
      <Link href="/reels/create" style={{ color: theme.primary, fontWeight: '700' }}>Create Reel</Link>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
        <Text style={{ color: theme.text, fontWeight: '700' }}>Edit profile</Text>
        <Input label="Name" value={name} onChangeText={setName} maxLength={100} />
        <Input label="Bio" value={bio} onChangeText={setBio} maxLength={160} multiline />
        <Input label="Website" value={website} onChangeText={setWebsite} autoCapitalize="none" placeholder="https://example.com" />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={visibility === 'private' ? 'Private' : 'Public'} onPress={() => setVisibility(visibility === 'private' ? 'public' : 'private')} disabled={busy} />
          <Button label={avatarMediaId ? 'Avatar ready' : uploadState === 'idle' ? 'Upload avatar' : uploadState.replaceAll('_', ' ')} onPress={() => void uploadAvatar()} disabled={busy} />
          <Button label="Save" onPress={() => void save()} disabled={busy || !name.trim()} />
        </View>
      </View>
      <Text style={{ color: theme.text, fontWeight: '700' }}>Follow requests</Text>
      {requests.data?.requests?.length ? requests.data.requests.map((request) => {
        const handle = request.user?.handle || request.requester?.handle || request.handle;
        return (
          <View key={handle || request.id} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8 }}>
            <Text style={{ color: theme.text }}>{request.user?.name || request.requester?.name || handle}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Approve" onPress={() => handle && void approveFollowRequest(handle).then(requests.refresh).then(followers.refresh)} />
              <Button label="Decline" onPress={() => handle && void declineFollowRequest(handle).then(requests.refresh)} />
            </View>
          </View>
        );
      }) : <EmptyState title="No follow requests" />}
      <Text style={{ color: theme.text, fontWeight: '700' }}>Followers</Text>
      {followers.data?.followers?.slice(0, 5).map((follower) => {
        const handle = follower.user?.handle || follower.handle;
        return (
          <View key={handle || follower.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 }}>
            <Text style={{ color: theme.text }}>{follower.user?.name || handle}</Text>
            {handle ? <Button label="Remove" onPress={() => void removeFollower(handle).then(followers.refresh).then(profile.refresh)} /> : null}
          </View>
        );
      })}
      <Text style={{ color: theme.text, fontWeight: '700' }}>Reels</Text>
      {reels.data?.reels?.length ? reels.data.reels.map((reel) => <ReelCard key={reel.id} reel={reel} />) : <EmptyState title="No Reels" />}
    </Screen>
  );
}
