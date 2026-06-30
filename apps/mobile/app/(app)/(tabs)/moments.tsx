import { useState } from 'react';
import { Text, View } from 'react-native';
import { archiveMoment, createMoment, listMoments, markMomentViewed, removeMomentReaction, replyToMoment, setMomentReaction } from '@/api/blabber';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';
import { uploadPickedImageForPublishing, type MobileImageUploadState } from '@/uploads/mobile-image-upload';

function MomentCard({ moment, owner, onChanged }: { moment: any; owner?: boolean; onChanged: () => Promise<void> }) {
  const theme = useTheme();
  const [reply, setReply] = useState('');
  const momentId = moment.id || moment._id;
  return (
    <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8, backgroundColor: theme.surface }}>
      <Text style={{ color: theme.text, fontWeight: '700' }}>{moment.author?.name || (owner ? 'Your Moment' : 'Moment')}</Text>
      <Text style={{ color: theme.text }}>{moment.textBody || moment.caption || (moment.type === 'image' ? 'Photo Moment' : '')}</Text>
      <Text style={{ color: theme.muted }}>{moment.viewerCount ?? 0} views · {moment.replyCount ?? 0} replies</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button label="View" onPress={() => void markMomentViewed(momentId).then(onChanged)} />
        <Button label={moment.myReaction ? 'Unreact' : 'React'} onPress={() => void (moment.myReaction ? removeMomentReaction(momentId) : setMomentReaction(momentId)).then(onChanged)} />
        {owner ? <Button label="Archive" onPress={() => void archiveMoment(momentId).then(onChanged)} /> : null}
      </View>
      {!owner ? (
        <View style={{ gap: 8 }}>
          <Input label="Reply" value={reply} onChangeText={setReply} maxLength={1000} />
          <Button label="Send reply" onPress={() => reply.trim() ? void replyToMoment(momentId, reply.trim()).then(() => { setReply(''); return onChanged(); }) : undefined} disabled={!reply.trim()} />
        </View>
      ) : null}
    </View>
  );
}

export default function Moments() {
  const theme = useTheme();
  const moments = useApiResource(() => listMoments(), []);
  const [textBody, setTextBody] = useState('');
  const [audienceType, setAudienceType] = useState<'contacts' | 'close_friends'>('contacts');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<MobileImageUploadState>('idle');
  const [busy, setBusy] = useState(false);

  const uploadPhoto = async () => {
    setBusy(true);
    try {
      const uploaded = await uploadPickedImageForPublishing(setUploadState);
      if (uploaded?.status === 'approved') setMediaId(uploaded.mediaId);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!textBody.trim() && !mediaId) return;
    setBusy(true);
    try {
      await createMoment({ textBody: mediaId ? undefined : textBody.trim(), caption: mediaId ? textBody.trim() || undefined : undefined, mediaId: mediaId || undefined, audienceType });
      setTextBody('');
      setMediaId(null);
      setUploadState('idle');
      await moments.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (moments.loading && !moments.data) return <LoadingState label="Loading Moments..." />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Moments</Text>
      {moments.error ? <ErrorState message={moments.error} /> : null}
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: theme.surface }}>
        <Input label="Moment" value={textBody} onChangeText={setTextBody} placeholder="Share a short Moment" maxLength={500} multiline />
        <Text style={{ color: theme.muted }}>{mediaId ? 'Photo ready' : uploadState === 'idle' ? 'Text or photo' : uploadState.replaceAll('_', ' ')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label={audienceType === 'contacts' ? 'Contacts' : 'Close friends'} onPress={() => setAudienceType(audienceType === 'contacts' ? 'close_friends' : 'contacts')} disabled={busy} />
          <Button label="Add photo" onPress={() => void uploadPhoto()} disabled={busy} />
          <Button label="Publish" onPress={() => void publish()} disabled={busy || (!textBody.trim() && !mediaId)} />
        </View>
      </View>
      <Text style={{ color: theme.text, fontWeight: '700' }}>Recent</Text>
      {moments.data?.recentMoments?.length ? moments.data.recentMoments.map((moment) => <MomentCard key={moment.id || moment._id} moment={moment} onChanged={moments.refresh} />) : <EmptyState title="No recent Moments" />}
      <Text style={{ color: theme.text, fontWeight: '700' }}>Yours</Text>
      {moments.data?.myMoments?.length ? moments.data.myMoments.map((moment) => <MomentCard key={moment.id || moment._id} moment={moment} owner onChanged={moments.refresh} />) : <EmptyState title="No active Moments" />}
    </Screen>
  );
}
