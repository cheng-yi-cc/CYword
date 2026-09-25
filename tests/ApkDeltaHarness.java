import me.chengyi.cyword.ApkDelta;
import me.chengyi.cyword.UpdateTransport;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class ApkDeltaHarness {
    public static void main(String[] args) throws Exception {
        List<String> lines = Files.readAllLines(Path.of(args[2]));
        String[] identity = lines.remove(0).split(" ");
        long size = Long.parseLong(identity[0]), offset = 0;
        List<ApkDelta.Block> blocks = new ArrayList<>();
        for (String line : lines) {
            String[] fields = line.split(" "); int length = Integer.parseInt(fields[0]);
            blocks.add(new ApkDelta.Block(offset, length, fields[1], fields.length == 3 ? Base64.getDecoder().decode(fields[2]) : null)); offset += length;
        }
        long bytes = ApkDelta.rebuild(new File(args[0]), new File(args[1]), blocks, size, identity[1],
            (start, length) -> UpdateTransport.read(args[3], length, start, size), (phase, completed, total, downloaded) -> {});
        System.out.println(bytes);
    }
}
