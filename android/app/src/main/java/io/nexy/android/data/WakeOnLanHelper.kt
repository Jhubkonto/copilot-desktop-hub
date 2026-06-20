package io.nexy.android.data

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

object WakeOnLanHelper {

    private const val WOL_PORT = 9

    fun sendMagicPacket(macAddress: String, broadcastAddress: String) {
        val macBytes = parseMac(macAddress)
        val packet = ByteArray(6 + 16 * 6)
        repeat(6) { packet[it] = 0xFF.toByte() }
        repeat(16) { repetition ->
            System.arraycopy(macBytes, 0, packet, 6 + repetition * 6, 6)
        }
        DatagramSocket().use { socket ->
            socket.broadcast = true
            val address = InetAddress.getByName(broadcastAddress)
            socket.send(DatagramPacket(packet, packet.size, address, WOL_PORT))
        }
    }

    private fun parseMac(mac: String): ByteArray {
        val hex = mac.replace(":", "").replace("-", "")
        require(hex.length == 12) { "Invalid MAC address: $mac" }
        return ByteArray(6) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }
}
