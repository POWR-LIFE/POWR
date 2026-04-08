import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { fetchProfile } from '@/lib/api/user';

export function ProfileButton() {
    const router = useRouter();
    const { user } = useAuth();

    const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '?';
    const avatarLetter = displayName[0]?.toUpperCase() ?? '?';

    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);

    useFocusEffect(
        useCallback(() => {
            setAvatarError(false);
            fetchProfile().then((p) => setAvatarUrl(p?.avatar_url ?? null));
        }, [])
    );

    return (
        <Pressable
            style={styles.avatar}
            onPress={() => router.push('/profile-screen')}
        >
            {avatarUrl && !avatarError ? (
                <Image
                    key={avatarUrl}
                    source={{ uri: avatarUrl }}
                    style={styles.avatarImage}
                    contentFit="cover"
                    onError={() => setAvatarError(true)}
                />
            ) : (
                <Text style={styles.avatarText}>{avatarLetter}</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#E8D200',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        overflow: 'hidden',
    },
    avatarImage: {
        width: 36,
        height: 36,
        borderRadius: 18,
    },
    avatarText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#0a0a0a',
    },
});
