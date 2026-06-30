import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/theme';

export function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: disabled ? theme.border : theme.primary, paddingHorizontal: 16 }}
    >
      <Text style={{ color: disabled ? theme.muted : '#ffffff', fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.text, fontWeight: '600' }}>{props.label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.label}
        placeholderTextColor={theme.muted}
        style={[{ minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: theme.border, color: theme.text, paddingHorizontal: 12, backgroundColor: theme.surface }, props.style]}
      />
    </View>
  );
}
