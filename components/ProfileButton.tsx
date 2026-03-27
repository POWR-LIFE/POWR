import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/context/AuthContext';

export function ProfileButton() {
    const router = useRouter();
    const { user } = useAuth();
    
    const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? '?' ;
    const firstName = displayName.split(' ')[0];
    const avatarLetter = firstName[0]?.toUpperCase() ?? '?';

    return (
        <Pressable
            style={styles.avatar}
            onPress={() => router.push('/profile-screen')}
        >
            <Text style={styles.avatarText}>{avatarLetter}</Text>
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
    },
    avatarText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#0a0a0a',
    },
});
